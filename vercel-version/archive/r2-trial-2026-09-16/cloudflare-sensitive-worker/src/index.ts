interface Env { SENSITIVE_BUCKET: R2Bucket; VERIFY_URL: string; }
const ALLOWED_ORIGINS = new Set(['https://levihan-tudou-d0g7jivue1ccc4a35-1325571558.tcloudbaseapp.com','https://levihan.asia','https://www.levihan.asia','http://127.0.0.1:4321','http://localhost:4321']);
const KEY_RE = /^lh-\d{1,4}\/[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const MAX_BYTES = 8 * 1024 * 1024;
function cors(request: Request) { const origin=request.headers.get('Origin')||''; return {'Access-Control-Allow-Origin':ALLOWED_ORIGINS.has(origin)?origin:'null','Access-Control-Allow-Methods':'PUT,OPTIONS','Access-Control-Allow-Headers':'Content-Type,X-Admin-Token','Access-Control-Max-Age':'86400','Vary':'Origin'}; }
function json(request: Request, body: unknown, status=200) { return Response.json(body,{status,headers:{...cors(request),'Cache-Control':'no-store'}}); }
async function verifyAdmin(request: Request, env: Env) { const token=request.headers.get('X-Admin-Token')||''; if(!token)return false; const response=await fetch(env.VERIFY_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'verifyToken',token})}); if(!response.ok)return false; const data=(await response.json().catch(()=>({}))) as {ok?:boolean}; return data.ok===true; }
export default { async fetch(request: Request, env: Env): Promise<Response> {
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request)});
  const url=new URL(request.url);
  if(request.method==='GET'&&url.pathname==='/health')return json(request,{ok:true,private:true});
  if(request.method!=='PUT'||url.pathname!=='/upload')return json(request,{ok:false,error:'NOT_FOUND'},404);
  if(!ALLOWED_ORIGINS.has(request.headers.get('Origin')||''))return json(request,{ok:false,error:'ORIGIN_DENIED'},403);
  if(!(await verifyAdmin(request,env)))return json(request,{ok:false,error:'ADMIN_AUTH_REQUIRED'},401);
  const key=url.searchParams.get('key')||''; if(!KEY_RE.test(key))return json(request,{ok:false,error:'INVALID_KEY'},400);
  const length=Number(request.headers.get('Content-Length')||0); if(length>MAX_BYTES)return json(request,{ok:false,error:'FILE_TOO_LARGE'},413);
  if(!request.body)return json(request,{ok:false,error:'EMPTY_BODY'},400);
  const contentType=request.headers.get('Content-Type')||'image/webp'; if(!/^image\/(webp|jpeg|png|gif|avif)$/i.test(contentType))return json(request,{ok:false,error:'INVALID_CONTENT_TYPE'},415);
  await env.SENSITIVE_BUCKET.put(key,request.body,{httpMetadata:{contentType,cacheControl:'private, no-store'},customMetadata:{classification:'mild-r18',uploadedAt:new Date().toISOString()}});
  return json(request,{ok:true,key,bytes:length||null});
} } satisfies ExportedHandler<Env>;
