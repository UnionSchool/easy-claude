import test from 'node:test';
import assert from 'node:assert/strict';
import {overlayError} from '../src/overlay-data.js';
test('认证错误投影白名单',()=>{for(const code of ['auth_required','auth_expired','other',undefined])assert.equal(overlayError(Object.assign(new Error('safe'),{code})).errorCode,['auth_required','auth_expired'].includes(code)?code:'query_failed');});
