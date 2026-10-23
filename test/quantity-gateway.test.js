import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {installQuantityGateway} from '../src/quantity-gateway.js';
test('gateway authenticates, checks current stock, keeps drafts unpublished, and verifies writes',async()=>{
  const previous=global.fetch,oldSecret=process.env.QUANTITY_GATEWAY_SECRET,oldEnabled=process.env.CENTRAL_QUANTITY_ENABLED;
  process.env.QUANTITY_GATEWAY_SECRET='x'.repeat(40);process.env.CENTRAL_QUANTITY_ENABLED='1';
  let handler,stock=0,published=false,writes=0;
  installQuantityGateway({post:(path,middleware,h)=>handler=h},()=>()=>{});
  global.fetch=async(url,options)=>{
    if(options.method==='PUT'){const body=JSON.parse(options.body);assert.equal(body.publish,undefined);stock=body.inventory;published=!!body.publish;writes++;}
    return new Response(JSON.stringify({id:12,sku:'A1W',state:'draft',inventory:stock}));
  };
  const invoke=async(body,authorized=true)=>{const result={status:200};const res={status:n=>(result.status=n,res),json:x=>result.body=x};
    await handler({body,get:()=>authorized?'Bearer '+process.env.QUANTITY_GATEWAY_SECRET:''},res);return result;};
  try{
    const body={operation:'write',id:'12',sku:'A1W',expected:0,desired:1,expectedState:'draft',everPublished:false};
    assert.equal((await invoke(body,false)).status,401);assert.equal(writes,0);
    assert.equal((await invoke({...body,expected:4})).status,409);assert.equal(writes,0);
    assert.equal((await invoke(body)).body.confirmed,true);assert.equal(stock,1);assert.equal(published,false);
    assert.equal((await invoke({operation:'read',path:'https://attacker.example/steal'})).status,409);
  }finally{global.fetch=previous;if(oldSecret===undefined)delete process.env.QUANTITY_GATEWAY_SECRET;else process.env.QUANTITY_GATEWAY_SECRET=oldSecret;if(oldEnabled===undefined)delete process.env.CENTRAL_QUANTITY_ENABLED;else process.env.CENTRAL_QUANTITY_ENABLED=oldEnabled;}
});
