//! Bounded stage workers. Readers are created inside their worker, never shared between threads.
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    mpsc,
};

use crate::{Error, Result};

pub(crate) fn workers(jobs: usize) -> usize {
    // Bound simultaneous scene graphs and map rasters while using up to eight available CPUs.
    let requested = std::env::var("DIGIATLAS_IMPORT_WORKERS")
        .ok()
        .and_then(|s| s.parse::<usize>().ok())
        .filter(|n| *n > 0)
        .unwrap_or(8)
        .min(8);
    std::thread::available_parallelism().map_or(1, usize::from).min(requested).min(jobs).max(1)
}

pub(crate) fn map_ordered<I: Sync, O: Send, C>(
    items: &[I],
    count: usize,
    init: impl Fn() -> Result<C> + Sync,
    work: impl Fn(&C, &I) -> Result<O> + Sync,
    mut complete: impl FnMut(usize, &I),
) -> Result<Vec<O>> {
    if items.is_empty() {
        return Ok(vec![]);
    }
    let next = AtomicUsize::new(0);
    let stopped = AtomicBool::new(false);
    std::thread::scope(|scope| {
        let (send, receive) = mpsc::channel();
        for worker in 0..count.max(1).min(items.len()) {
            let send = send.clone();
            let next = &next;
            let stopped = &stopped;
            let init = &init;
            let work = &work;
            let spawned = std::thread::Builder::new()
                .name(format!("stage-import-{worker}"))
                .stack_size(crate::STACK_SIZE)
                .spawn_scoped(scope, move || {
                    // C deliberately need not be Send: Rc/RefCell disc readers belong here.
                    let context = match init() {
                        Ok(context) => context,
                        Err(error) => {
                            stopped.store(true, Ordering::Release);
                            let _ = send.send(Err(error));
                            return;
                        }
                    };
                    while !stopped.load(Ordering::Acquire) {
                        let index = next.fetch_add(1, Ordering::Relaxed);
                        let Some(item) = items.get(index) else { break };
                        let result = catch_unwind(AssertUnwindSafe(|| work(&context, item)))
                            .unwrap_or_else(|_| Err(Error("A stage import worker stopped unexpectedly".into())));
                        let failed = result.is_err();
                        if failed {
                            stopped.store(true, Ordering::Release);
                        }
                        if send.send(result.map(|output| (index, output))).is_err() || failed {
                            break;
                        }
                    }
                });
            if let Err(error) = spawned {
                stopped.store(true, Ordering::Release);
                return Err(error.into());
            }
        }
        drop(send);
        let mut outputs: Vec<Option<O>> = std::iter::repeat_with(|| None).take(items.len()).collect();
        let mut done = 0;
        let mut failure = None;
        for result in receive {
            match result {
                Ok((index, output)) => {
                    outputs[index] = Some(output);
                    done += 1;
                    if failure.is_none() {
                        complete(done, &items[index]);
                    }
                }
                Err(error) => {
                    stopped.store(true, Ordering::Release);
                    if failure.is_none() {
                        failure = Some(error);
                    }
                }
            }
        }
        if let Some(error) = failure {
            return Err(error);
        }
        outputs
            .into_iter()
            .map(|item| item.ok_or_else(|| Error("A stage import worker returned no result".into())))
            .collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, rc::Rc, sync::Mutex, time::Duration};

    #[test]
    fn runs_concurrently_with_worker_owned_readers_and_returns_original_order() {
        let (send, receive) = mpsc::channel();
        let receive = Mutex::new(receive);
        let result = map_ordered(
            &[0, 1, 2],
            2,
            || Ok(Rc::new(Cell::new(0))),
            |context, item| {
                context.set(context.get() + 1);
                if *item == 0 {
                    receive
                        .lock()
                        .unwrap()
                        .recv_timeout(Duration::from_secs(5))
                        .map_err(|_| Error("workers ran sequentially".into()))?;
                }
                if *item == 1 {
                    send.send(()).unwrap();
                }
                Ok(item * 2)
            },
            |_, _| {},
        )
        .unwrap();
        assert_eq!(result, [0, 2, 4]);
    }

    #[test]
    fn worker_errors_and_panics_fail_the_whole_batch() {
        let result = map_ordered(&[0, 1, 2], 2, || Ok(()), |_, _| Err::<(), _>(Error("bad stage".into())), |_, _| {});
        assert_eq!(result.unwrap_err().0, "bad stage");
        let result = map_ordered(&[0], 1, || Ok(()), |_, _| -> Result<()> { panic!("worker fixture") }, |_, _| {});
        assert!(result.unwrap_err().0.contains("worker stopped"));
    }

    #[test]
    fn empty_batches_do_not_open_readers() {
        let result =
            map_ordered(&[] as &[i32], 4, || -> Result<()> { panic!("no reader needed") }, |_, n| Ok(*n), |_, _| {})
                .unwrap();
        assert!(result.is_empty());
        assert_eq!(workers(1), 1);
        assert!((1..=8).contains(&workers(98)));
    }
}
