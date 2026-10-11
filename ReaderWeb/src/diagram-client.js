// Parent-owned deadlines can interrupt synchronous WASM by terminating its worker.
export class DiagramClient {
  constructor({workerFactory=()=>new Worker(new URL('./diagram.worker.js',import.meta.url),{type:'module'}),timeoutMs=8000,maxQueue=16}={}) {
    this.factory=workerFactory;this.timeoutMs=timeoutMs;this.maxQueue=maxQueue;
    this.worker=null;this.active=null;this.queue=[];this.sequence=0;this.restarts=0;
  }
  run(source,palette,{signal}={}) {
    if(signal?.aborted)return Promise.reject(new DOMException('绘图已取消','AbortError'));
    if(source.length>100000)return Promise.reject(new Error('图表源码超过长度限制'));
    if(this.queue.length>=this.maxQueue)return Promise.reject(new Error('绘图队列已满，请稍后重试'));
    return new Promise((resolve,reject)=>{
      const job={id:++this.sequence,source,palette,resolve,reject,signal};
      job.abort=()=>{
        if(this.active===job){this.stopWorker();this.finish(job,new DOMException('绘图已取消','AbortError'));}
        else {this.queue=this.queue.filter(item=>item!==job);this.finish(job,new DOMException('绘图已取消','AbortError'));}
      };
      signal?.addEventListener('abort',job.abort,{once:true});this.queue.push(job);this.pump();
    });
  }
  pump(){
    if(this.active||!this.queue.length)return;
    const job=this.active=this.queue.shift();
    try {
      if(!this.worker){
        const worker=this.worker=this.factory();
        worker.onmessage=({data})=>{
          if(this.worker!==worker||this.active?.id!==data.id)return;
          this.finish(this.active,data.error?new Error(data.error):null,data.svg);
        };
        worker.onerror=event=>{event.preventDefault?.();if(this.worker!==worker)return;const active=this.active;this.stopWorker();if(active)this.finish(active,new Error('隔离绘图组件加载失败'));};
        worker.onmessageerror=()=>{if(this.worker!==worker)return;const active=this.active;this.stopWorker();if(active)this.finish(active,new Error('隔离绘图返回了无效结果'));};
      }
      job.timer=setTimeout(()=>{if(this.active!==job)return;this.stopWorker();this.finish(job,new Error('绘图超时，任务已终止；可重试或选择兼容绘图'));},this.timeoutMs);
      this.worker.postMessage({id:job.id,source:job.source,palette:job.palette});
    }catch(error){this.stopWorker();this.finish(job,error);}
  }
  finish(job,error,svg){
    clearTimeout(job.timer);job.signal?.removeEventListener('abort',job.abort);
    if(this.active===job)this.active=null;
    if(error)job.reject(error);
    else if(typeof svg!=='string'||svg.length>4000000)job.reject(new Error('图表输出超过限制或格式无效'));
    else job.resolve(svg);
    this.pump();
  }
  stopWorker(){this.worker?.terminate();this.worker=null;this.restarts++;}
  cancel(){
    const jobs=[...(this.active?[this.active]:[]),...this.queue];this.active=null;this.queue=[];
    if(jobs.length)this.stopWorker();
    for(const job of jobs)this.finish(job,new DOMException('文档或显示设置已切换','AbortError'));
  }
  diagnostics(){return {active:!!this.active,queued:this.queue.length,restarts:this.restarts};}
}
