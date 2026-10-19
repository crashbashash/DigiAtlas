import { expect, it, vi } from 'vitest';
import { UpdateController, type UpdateCheck, type UpdateOffer } from './updates';
const offer: UpdateOffer = {
  version: '0.3.0',
  currentVersion: '0.1.0',
  method: 'browser',
  releases: [
    { version: '0.3.0', notes: 'New maps' },
    { version: '0.2.0', notes: 'New calculator' },
  ],
};
const backend = () => ({
  check: vi.fn(async (): Promise<UpdateCheck> => ({ currentVersion: '0.1.0', update: offer })),
  accept: vi.fn(async (_version: string): Promise<'browser' | 'installer'> => 'browser'),
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
it('checks once across screen changes and never installs without accepting', async () => {
  const api = backend(),
    controller = new UpdateController(api);
  const listener = vi.fn();
  const unsubscribe = controller.subscribe(listener);
  controller.start();
  controller.start();
  await settle();
  unsubscribe();
  controller.start();
  expect(api.check).toHaveBeenCalledTimes(1);
  expect(controller.state.offer?.releases).toHaveLength(2);
  expect(api.accept).not.toHaveBeenCalled();
  controller.dismiss();
  expect(controller.state.offer).toBeNull();
  await controller.check();
  expect(controller.state.offer).toEqual(offer);
  await controller.accept();
  expect(api.accept).toHaveBeenCalledWith('0.3.0');
  expect(controller.state.offer).toBeNull();
});
it('is quiet offline at startup and explains failures for manual checks', async () => {
  const api = backend();
  api.check.mockRejectedValue(new Error('offline'));
  const controller = new UpdateController(api);
  controller.start();
  await settle();
  expect(controller.state.notice).toBeNull();
  expect(controller.state.checking).toBe(false);
  await controller.check();
  expect(controller.state.notice?.title).toBe('Unable to check for updates');
});
it('reports the current version when no newer stable release exists', async () => {
  const api = backend();
  api.check.mockResolvedValue({ currentVersion: '0.3.0', update: null });
  const controller = new UpdateController(api);
  await controller.check();
  expect(controller.state.notice).toEqual({
    title: "You're up to date",
    message: "You're using DigiAtlas 0.3.0.",
  });
});
it('does not duplicate checks or updates and keeps installer state busy', async () => {
  const api = backend();
  let resolve: (value: UpdateCheck) => void = () => {};
  api.check.mockImplementation(
    () =>
      new Promise((r) => {
        resolve = r;
      }),
  );
  const controller = new UpdateController(api);
  const pending = controller.check();
  await controller.check();
  expect(api.check).toHaveBeenCalledTimes(1);
  resolve({ currentVersion: '0.1.0', update: { ...offer, method: 'msi' } });
  await pending;
  api.accept.mockResolvedValue('installer');
  await controller.accept();
  await controller.accept();
  await controller.check();
  controller.dismiss();
  expect(api.accept).toHaveBeenCalledTimes(1);
  expect(api.check).toHaveBeenCalledTimes(1);
  expect(controller.state.updating).toBe(true);
  expect(controller.state.offer).not.toBeNull();
});
it('allows a retry after a failed accepted update', async () => {
  const api = backend();
  api.accept.mockRejectedValueOnce(new Error('Checksum mismatch'));
  const controller = new UpdateController(api);
  await controller.check();
  await controller.accept();
  expect(controller.state.error).toBe('Checksum mismatch');
  expect(controller.state.updating).toBe(false);
  await controller.accept();
  expect(api.accept).toHaveBeenCalledTimes(2);
  expect(controller.state.offer).toBeNull();
});

it('distinguishes an unpublished update feed from an up-to-date result', async () => {
  const api = backend();
  api.check.mockRejectedValue('Updates are not publicly available yet.');
  const controller = new UpdateController(api);
  await controller.check();
  expect(controller.state.notice).toEqual({
    title: 'Unable to check for updates',
    message: 'Updates are not publicly available yet.',
  });
});
