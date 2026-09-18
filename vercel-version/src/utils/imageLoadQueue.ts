/**
 * 图片加载队列：严格控制 COS 图片并发请求数量
 * 防止漫画阅读器一次性发起大量图片请求导致流量暴增
 */

type QueueTask<T> = () => Promise<T>;

class ImageLoadQueue {
  private readonly concurrency: number;
  private active = 0;
  private queue: Array<{
    task: QueueTask<unknown>;
    resolve: (value: unknown) => void;
    reject: (reason?: unknown) => void;
  }> = [];

  constructor(concurrency = 2) {
    this.concurrency = concurrency;
  }

  add<T>(task: QueueTask<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      this.process();
    });
  }

  private process() {
    while (
      this.active < this.concurrency &&
      this.queue.length > 0
    ) {
      const item = this.queue.shift();

      if (!item) {
        return;
      }

      this.active += 1;

      item.task()
        .then(item.resolve)
        .catch(item.reject)
        .finally(() => {
          this.active -= 1;
          this.process();
        });
    }
  }

  clear() {
    this.queue.length = 0;
  }

  getStats() {
    return {
      active: this.active,
      queued: this.queue.length,
      concurrency: this.concurrency,
    };
  }
}

export const imageLoadQueue = new ImageLoadQueue(2);
