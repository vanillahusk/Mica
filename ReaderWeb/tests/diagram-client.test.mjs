import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagramClient} from '../src/diagram-client.js';
const palette={};
function setup(options={}){
  const workers=[];
  const client=new DiagramClient({...options,workerFactory:()=>{const w={terminated:false,sent:[],postMessage(m){this.sent.push(m);},terminate(){this.terminated=true;}};workers.push(w);return w;}});
  return {client,workers,reply(svg='svg'){const w=workers.at(-1);w.onmessage({data:{id:w.sent.at(-1).id,svg}});}};
}
test('serial queue, cancellation and stale worker replies',async()=>{
  const {client,workers,reply}=setup();
  const one=client.run('one',palette),two=client.run('two',palette);
  assert.equal(workers[0].sent.length,1);reply();assert.equal(await one,'svg');assert.equal(workers[0].sent.length,2);
  const caught=two.catch(e=>e.name);client.cancel();assert.equal(await caught,'AbortError');assert(workers[0].terminated);
  const next=client.run('next',palette);workers[0].onmessage({data:{id:3,svg:'stale'}});reply('fresh');assert.equal(await next,'fresh');client.cancel();
});
test('deadline kills worker and next request recreates it',async()=>{
  const {client,workers,reply}=setup({timeoutMs:20});
  await assert.rejects(client.run('busy',palette),/超时/);assert(workers[0].terminated);
  const next=client.run('recovered',palette);reply('ok');assert.equal(await next,'ok');assert.equal(workers.length,2);client.cancel();
});
test('abort active and queued jobs without poisoning following work',async()=>{
  const {client,workers,reply}=setup();const a=new AbortController(),b=new AbortController();
  const one=client.run('one',palette,{signal:a.signal}).catch(e=>e.name);
  const two=client.run('two',palette,{signal:b.signal}).catch(e=>e.name);
  b.abort();assert.equal(await two,'AbortError');assert.equal(client.queue.length,0);
  a.abort();assert.equal(await one,'AbortError');assert(workers[0].terminated);
  const next=client.run('three',palette);reply();await next;client.cancel();
});
test('bounded input, queue and output',async()=>{
  const {client,reply}=setup({maxQueue:1});
  await assert.rejects(client.run('x'.repeat(100001),palette),/长度/);
  const one=client.run('one',palette),two=client.run('two',palette);
  await assert.rejects(client.run('three',palette),/队列/);
  reply();await one;reply('x'.repeat(4000001));await assert.rejects(two,/限制/);client.cancel();
});
