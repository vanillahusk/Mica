import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const directory=await mkdtemp(resolve('build/protocol-'));
const p=spawn(resolve('Mica.exe'),['--native-messaging'],{windowsHide:true,env:{...process.env,MICA_DATA_DIRECTORY:directory},stdio:['pipe','pipe','pipe']});
const output=[],errors=[];p.stdout.on('data',b=>output.push(b));p.stderr.on('data',b=>errors.push(b));
const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error(Buffer.concat(errors).toString()||'exit '+code)))});
const frame=message=>{const b=Buffer.from(JSON.stringify(message)),h=Buffer.alloc(4);h.writeUInt32LE(b.length);return Buffer.concat([h,b])};
p.stdin.end(Buffer.concat([frame({type:'syncConversation',protocolVersion:1,open:false,conversation:{id:'native-protocol',title:'同步测试',messages:[{id:'q',role:'user',text:'你好'}]}}),frame({type:'syncConversation',protocolVersion:1,open:false,conversation:{id:'native-protocol',title:'同步测试',messages:[{id:'a',role:'assistant',text:'原生同步成功'}]}})]));
const timer=setTimeout(()=>{p.kill();},15000);try{await done}finally{clearTimeout(timer)}
let b=Buffer.concat(output),responses=[];while(b.length){const len=b.readUInt32LE();responses.push(JSON.parse(b.subarray(4,4+len)));b=b.subarray(4+len)}
assert.equal(responses.length,2);assert.equal(responses[0].ok,true);assert.equal(responses[1].messageCount,2);console.log('PASS production executable: Native Messaging framing, persistence and merge');
