import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRequest } from '../src/middleware/validateRequest';
import { requireAuth, requireRole } from '../src/middleware/auth';

function mockResponse() {
  const state: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  const res: any = { status(code:number) { state.statusCode=code; return this; }, json(body:unknown) { state.body=body; return this; } };
  return { res, state };
}

test('Phase 0 request validator accepts JSON object bodies', () => {
  const {res,state}=mockResponse(); let called=false;
  validateRequest({body:{message:'hello'}} as any,res,()=>{called=true;});
  assert.equal(called,true); assert.equal(state.statusCode,200);
});

test('Phase 0 request validator rejects non-object JSON bodies', () => {
  const {res,state}=mockResponse(); let called=false;
  validateRequest({body:'bad'} as any,res,()=>{called=true;});
  assert.equal(called,false); assert.equal(state.statusCode,400);
});

test('admin routes reject requests without bearer tokens', () => {
  const {res,state}=mockResponse(); let called=false;
  requireAuth({headers:{}} as any,res,()=>{called=true;});
  assert.equal(called,false); assert.equal(state.statusCode,401);
});

test('role guard rejects a customer from admin operations', () => {
  const {res,state}=mockResponse(); let called=false;
  requireRole('admin')({auth:{sub:'1',role:'customer'}} as any,res,()=>{called=true;});
  assert.equal(called,false); assert.equal(state.statusCode,403);
});
