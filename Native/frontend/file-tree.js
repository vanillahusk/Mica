export function appendFileTree(host,documents,{open,manageDocument,manageFolder,action}){
 const root={folders:new Map(),files:[],documents:[]};
 for(const item of documents){
  const parts=String(item.title||'').split(/[\\/]+/).filter(Boolean),file=parts.pop()||item.title;
  let branch=root;branch.documents.push(item);
  for(const part of parts){
   if(!branch.folders.has(part))branch.folders.set(part,{folders:new Map(),files:[],documents:[]});
   branch=branch.folders.get(part);branch.documents.push(item);
  }
  branch.files.push({...item,displayName:file});
 }
 const point=(event,element)=>event.clientX||event.clientY?{x:event.clientX,y:event.clientY}:{x:element.getBoundingClientRect().left+16,y:element.getBoundingClientRect().bottom};
 const render=(branch,parent)=>{
  for(const [name,folder] of [...branch.folders].sort(([a],[b])=>a.localeCompare(b,'zh-CN'))){
   const details=document.createElement('details');details.className='file-tree-folder';details.open=true;
   const summary=document.createElement('summary');summary.title='右键管理文件夹';summary.innerHTML='<span class="tree-chevron">⌄</span><span class="tree-folder-name"></span>';
   summary.querySelector('.tree-folder-name').textContent=name;
   summary.oncontextmenu=event=>{event.preventDefault();const at=point(event,summary);manageFolder(name,folder.documents,at.x,at.y)};
   const children=document.createElement('div');children.className='file-tree-children';details.append(summary,children);parent.append(details);render(folder,children);
  }
  for(const item of branch.files.sort((a,b)=>a.displayName.localeCompare(b.displayName,'zh-CN'))){
   const row=document.createElement('div');row.className='library-row file-tree-file';
   const button=document.createElement('button');button.className='item';button.title=item.path+'\n右键管理';button.append(document.createTextNode(item.displayName+(item.missing?' · 已移动':'')));button.onclick=action(()=>open(item));
   button.oncontextmenu=event=>{event.preventDefault();const at=point(event,button);manageDocument(item,at.x,at.y)};
   const extension=item.displayName.includes('.')?item.displayName.split('.').pop().toUpperCase():'';
   if(extension&&extension.length<=4){const kind=document.createElement('small');kind.className='file-kind';kind.textContent=extension;button.append(kind)}
   row.append(button);parent.append(row);
  }
 };
 render(root,host);
}
