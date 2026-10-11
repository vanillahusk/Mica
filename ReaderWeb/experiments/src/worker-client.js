// Experimental one-at-a-time renderer with parent-owned hard deadlines.
export class WorkerClient {
  constructor(){this.sequence=0;this.worker=null;this.pending=null;this.restarts=0;}
  ensure(){
    if(this.worker)return;
    this.worker=new Worker(new URL('./engine-worker.js',import.meta.url),{type:'module'});
    this.worker.onmessage=({data})=>{
      if(!this.pending||data.id!==this.pending.id)return;
      const request=this.pending;this.pending=null;clearTimeout(request.timer);
      if(data.error)request.reject(new Error(data.error));else request.resolve(data);
    };
    this.worker.onerror=event=>{event.preventDefault();this.cancel('worker failed: '+event.message);};
  }
  run(source,{timeout=10000,operation='render',duration=0,safePipeline=false}={}){
    if(this.pending)throw new Error('Only one active render is admitted');
    this.ensure();
    return new Promise((resolve,reject)=>{
      const id=++this.sequence;
      const timer=setTimeout(()=>this.cancel('deadline exceeded'),timeout);
      this.pending={id,resolve,reject,timer};this.worker.postMessage({id,source,operation,duration,safePipeline});
    });
  }
  cancel(reason='cancelled'){
    this.worker?.terminate();this.worker=null;this.restarts++;
    if(this.pending){const request=this.pending;this.pending=null;clearTimeout(request.timer);request.reject(new Error(reason));}
  }
}
