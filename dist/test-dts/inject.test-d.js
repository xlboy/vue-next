import { provide, inject, expectType } from './index';
const key = Symbol();
provide(key, 1);
// @ts-expect-error
provide(key, 'foo');
expectType(inject(key));
expectType(inject(key, 1));
expectType(inject(key, () => 1, true /* treatDefaultAsFactory */));
expectType(inject('foo', () => 1));
expectType(inject('foo', () => 1, false));
expectType(inject('foo', () => 1, true));
