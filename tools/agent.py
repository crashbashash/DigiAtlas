#!/usr/bin/env python3
"""Control DigiAtlas's real webview without desktop mouse or keyboard input.

Requires the opt-in agent-control build; session credentials stay in a private local file.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import time
import urllib.error
import urllib.request


def evaluate(session, script):
    info = json.loads(Path(session).read_text())
    request = urllib.request.Request(
        f"http://127.0.0.1:{info['port']}/eval",
        data=json.dumps({"script": script}).encode(),
        headers={"Authorization": f"Bearer {info['token']}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        result = json.load(response)
    if not result['ok']:
        raise RuntimeError(result['error'])
    return result.get('value')


LABELS = """
const visible = e => e.getClientRects().length > 0;
const label = e => e.getAttribute('aria-label') || [...(e.closest('label')?.childNodes || [])]
  .filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join(' ').trim();
"""
SETTLE = "await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--session', required=True)
    commands = parser.add_subparsers(dest='command', required=True)
    start = commands.add_parser('start')
    start.add_argument('--binary', required=True)
    start.add_argument('--port', type=int, default=0)
    start.add_argument('--open', default='#/calculators/power-down')
    start.add_argument('--iso')
    commands.add_parser('snapshot')
    nav = commands.add_parser('navigate'); nav.add_argument('hash')
    click = commands.add_parser('click'); click.add_argument('text')
    for name in ['fill', 'select']:
        p = commands.add_parser(name); p.add_argument('label'); p.add_argument('value')
    load = commands.add_parser('load-save'); load.add_argument('path')
    disc = commands.add_parser('import-iso'); disc.add_argument('path')
    script = commands.add_parser('eval'); script.add_argument('script', help='async JavaScript body; use return for its result')
    args = parser.parse_args()
    session = Path(args.session)
    if args.command == 'start':
        session.parent.mkdir(parents=True, exist_ok=True)
        token = secrets.token_urlsafe(32)
        port = args.port
        if not port:
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0)); port = sock.getsockname()[1]
        fd = os.open(session, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        env = dict(os.environ, DIGIATLAS_AGENT_TOKEN=token, DIGIATLAS_AGENT_PORT=str(port))
        binary = str(Path(args.binary).resolve())
        command = [binary, '--open', args.open]
        if args.iso: command += ['--iso', str(Path(args.iso).resolve())]
        with open(str(session) + '.log', 'wb') as log:
            child = subprocess.Popen(command, env=env, stdout=log, stderr=log, start_new_session=True)
        with os.fdopen(fd, 'w') as output:
            json.dump({'port': port, 'token': token, 'pid': child.pid, 'binary': binary}, output)
        for _ in range(100):
            if child.poll() is not None:
                raise RuntimeError(f"DigiAtlas exited; see {session}.log")
            try:
                evaluate(session, 'return {ready: !!document.body};')
                print(json.dumps({'pid': child.pid, 'session': str(session)})); return
            except (OSError, RuntimeError, urllib.error.URLError): time.sleep(.1)
        raise RuntimeError(f"Agent did not become ready; see {session}.log")
    if args.command == 'snapshot':
        script = LABELS + """
return {title: document.title, hash: location.hash, text: document.body.innerText,
  inputs: [...document.querySelectorAll('input,select')].filter(visible).map(e =>
    ({label:label(e),type:e.type,value:e.value,options:e.tagName==='SELECT'?[...e.options].map(o=>({value:o.value,text:o.text})):undefined})),
  buttons: [...document.querySelectorAll('button')].filter(visible).map(e=>({text:e.innerText,label:e.getAttribute('aria-label'),disabled:e.disabled})),
  links: [...document.querySelectorAll('a')].filter(visible).map(e=>({text:e.innerText,href:e.getAttribute('href')}))};
"""
    elif args.command == 'navigate':
        if not args.hash.startswith('#/'): raise ValueError('expected a #/ route')
        script = f'location.hash={json.dumps(args.hash)}; {SETTLE} return location.hash;'
    elif args.command == 'click':
        script = LABELS + f"""
const matches=[...document.querySelectorAll('button,a')].filter(e=>visible(e) &&
  (e.innerText.trim()==={json.dumps(args.text)} || e.getAttribute('aria-label')==={json.dumps(args.text)}));
if(matches.length!==1)throw Error('Expected one matching button or link, got '+matches.length);
if(matches[0].disabled)throw Error('Control is disabled');
matches[0].click(); {SETTLE} return true;
"""
    elif args.command in ['fill','select']:
        selector = 'input' if args.command == 'fill' else 'select'
        script = LABELS + f"""
const matches=[...document.querySelectorAll('{selector}')].filter(e=>visible(e)&&label(e)==={json.dumps(args.label)});
if(matches.length!==1)throw Error('Expected one labelled {selector}');
const e=matches[0]; let value={json.dumps(args.value)};
"""
        if args.command == 'select':
            script = script.replace("if(matches.length!==1)throw Error('Expected one labelled select');", f"""
if(matches.length===0){{
  const triggers=[...document.querySelectorAll('[data-picker-label]')].filter(e=>visible(e)&&e.dataset.pickerLabel==={json.dumps(args.label)});
  if(triggers.length!==1)throw Error('Expected one picker');
  const trigger=triggers[0];if(trigger.disabled)throw Error('Control is disabled');
  trigger.click();{SETTLE}
  const popup=document.getElementById(trigger.getAttribute('popovertarget'));
  const options=[...popup.querySelectorAll('[data-picker-option-value]')];
  const option=options.find(e=>e.dataset.pickerOptionValue==={json.dumps(args.value)})||options.find(e=>e.dataset.pickerOptionLabel==={json.dumps(args.value)});
  if(!option)throw Error('Option missing');option.click();{SETTLE}return trigger.dataset.pickerValue;
}}
if(matches.length!==1)throw Error('Expected one labelled select');
""")
        if args.command == 'select':
            script += "const option=[...e.options].find(o=>o.value===value)||[...e.options].find(o=>o.text===value); if(!option)throw Error('Option missing');value=option.value;"
        script += f"e.value=value;e.dispatchEvent(new Event('input',{{bubbles:true}}));e.dispatchEvent(new Event('change',{{bubbles:true}}));{SETTLE}return e.value;"
    elif args.command == 'load-save':
        path = Path(args.path).resolve()
        script = f"""
const buffer=await window.__TAURI_INTERNALS__.invoke('agent_read_file',{{path:{json.dumps(str(path))}}});
const input=document.querySelector('input[type=file]');if(!input)throw Error('Save input missing');
const files=new DataTransfer(); files.items.add(new File([buffer],{json.dumps(path.name)}));
input.files=files.files;input.dispatchEvent(new Event('change',{{bubbles:true}}));
await new Promise(r=>setTimeout(r,150)); {SETTLE} return {{text:document.body.innerText}};
"""
    elif args.command == 'import-iso':
        path = str(Path(args.path).resolve())
        script = f"""
await window.__TAURI_INTERNALS__.invoke('agent_set_disc_image',{{path:{json.dumps(path)}}});
location.hash='#/'; {SETTLE}
const reimport=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Re-import from disc');
if(reimport){{reimport.click(); {SETTLE}}}
const choose=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Load your Digimon World 4 disc image (PS2 or GameCube)');
if(!choose)throw Error('Import screen missing');choose.click(); {SETTLE}return document.body.innerText;
"""
    else: script = args.script
    print(json.dumps(evaluate(session, script), indent=2, ensure_ascii=False))


if __name__ == '__main__':
    main()
