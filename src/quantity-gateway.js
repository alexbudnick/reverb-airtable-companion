import {timingSafeEqual} from 'node:crypto';
import {CFG} from './lib.js';

const state=o=>typeof o?.state==='string'?o.state:o?.state?.slug;
const listing=o=>({id:o.id,sku:o.sku,inventory:o.inventory,state:state(o),updated_at:o.updated_at,
  published_at:o.published_at,condition:o.condition,has_inventory:o.has_inventory});
const order=o=>({id:o.order_number||o.id,status:typeof o.status==='string'?o.status:o.status?.slug,
  sku:o.sku||o.listing?.sku,listing_id:o.listing?.id||o.listing_id,quantity:o.quantity||1,
  created_at:o.created_at,updated_at:o.updated_at});
function authorized(req){
  const a=Buffer.from(process.env.QUANTITY_GATEWAY_SECRET||''),b=Buffer.from(req.get('Authorization')?.replace(/^Bearer /,'')||'');
  return a.length>=32&&a.length===b.length&&timingSafeEqual(a,b);
}
function safeUrl(path){
  const url=new URL(path,'https://api.reverb.com/api/');
  if(url.origin!=='https://api.reverb.com'||!/^\/api\/(my\/listings|my\/orders\/selling\/(all|unpaid)|listings\/\d+)$/.test(url.pathname))throw Error('Unsupported Reverb read path');
  return url;
}
async function call(path,options={}){
  const response=await fetch(safeUrl(path),{...options,headers:{Authorization:`Bearer ${CFG.reverb.token}`,
    'Accept-Version':'3.0',Accept:'application/hal+json','Content-Type':'application/hal+json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Warehouse Reverb HTTP ${response.status}`);
  const text=await response.text();return text?JSON.parse(text):{};
}
export function installQuantityGateway(app,json){
  app.post('/quantity/gateway',json({limit:'128kb'}),async(req,res)=>{
    if(!authorized(req))return res.status(401).json({error:'Unauthorized'});
    try{
      if(req.body.operation==='read'){
        const data=await call(req.body.path),list=data.listings||data._embedded?.listings;
        if(Array.isArray(list))return res.json({listings:list.map(listing),next:data._links?.next?.href||null});
        if(Array.isArray(data.orders))return res.json({orders:data.orders.map(order),next:data._links?.next?.href||null});
        return res.json({listing:listing(data.listing||data)});
      }
      if(req.body.operation!=='write'||process.env.CENTRAL_QUANTITY_ENABLED!=='1')throw Error('Quantity writes are disabled');
      const {id,sku,expected,desired,expectedState,everPublished}=req.body;
      if(!/^\d+$/.test(String(id))||typeof sku!=='string'||!Number.isSafeInteger(expected)||!Number.isSafeInteger(desired)||desired<0)throw Error('Invalid inventory intent');
      const path=`/api/listings/${id}`,before=listing(await call(path));
      if(before.sku!==sku||before.inventory!==expected||before.state!==expectedState)throw Error('Warehouse listing changed before write');
      const payload={inventory:desired};
      if(desired===0&&before.state==='live')payload.state='ended';
      if(desired>0&&['sold','ended','draft'].includes(before.state)&&everPublished){
        payload.publish=true;payload.has_inventory=before.has_inventory;
        if(before.condition)payload.condition=before.condition;
      }else if(desired>0&&!['live','draft'].includes(before.state))throw Error('Publication history requires review');
      await call(path,{method:'PUT',body:JSON.stringify(payload)});
      const after=listing(await call(path));
      if(after.sku!==sku||after.inventory!==desired||(payload.publish&&after.state!=='live')||(desired===0&&after.state==='live'))throw Error('Warehouse write sent but not confirmed');
      res.json({confirmed:true,listing:after});
    }catch(error){res.status(409).json({error:String(error.message).slice(0,250)});}
  });
}
