import { ref, shallowRef, isRef, unref, reactive, expectType, proxyRefs, toRef, toRefs } from './index';
function plainType(arg) {
    // ref coercing
    const coerced = ref(arg);
    expectType(coerced);
    // isRef as type guard
    if (isRef(arg)) {
        expectType(arg);
    }
    // ref unwrapping
    expectType(unref(arg));
    // ref inner type should be unwrapped
    const nestedRef = ref({
        foo: ref(1)
    });
    expectType(nestedRef.value);
    // ref boolean
    const falseRef = ref(false);
    expectType(falseRef);
    expectType(falseRef.value);
    // ref true
    const trueRef = ref(true);
    expectType(trueRef);
    expectType(trueRef.value);
    // tuple
    expectType(unref(ref([1, '1'])));
    // with symbol
    expectType(ref());
    // should not unwrap ref inside arrays
    const arr = ref([1, new Map(), ref('1')]).value;
    const value = arr[0];
    if (isRef(value)) {
        expectType(value);
    }
    else if (typeof value === 'number') {
        expectType(value);
    }
    else {
        // should narrow down to Map type
        // and not contain any Ref type
        expectType(value);
    }
    // should still unwrap in objects nested in arrays
    const arr2 = ref([{ a: ref(1) }]).value;
    expectType(arr2[0].a);
}
plainType(1);
function bailType(arg) {
    // ref coercing
    const coerced = ref(arg);
    expectType(coerced);
    // isRef as type guard
    if (isRef(arg)) {
        expectType(arg);
    }
    // ref unwrapping
    expectType(unref(arg));
    // ref inner type should be unwrapped
    // eslint-disable-next-line no-restricted-globals
    const nestedRef = ref({ foo: ref(document.createElement('DIV')) });
    expectType(nestedRef);
    expectType(nestedRef.value);
}
// eslint-disable-next-line no-restricted-globals
const el = document.createElement('DIV');
bailType(el);
function withSymbol() {
    const customSymbol = Symbol();
    const obj = {
        [Symbol.asyncIterator]: { a: 1 },
        [Symbol.unscopables]: { b: '1' },
        [customSymbol]: { c: [1, 2, 3] }
    };
    const objRef = ref(obj);
    expectType(objRef.value[Symbol.asyncIterator]);
    expectType(objRef.value[Symbol.unscopables]);
    expectType(objRef.value[customSymbol]);
}
withSymbol();
const state = reactive({
    foo: {
        value: 1,
        label: 'bar'
    }
});
expectType(state.foo.label);
const shallowStatus = shallowRef('initial');
if (shallowStatus.value === 'initial') {
    expectType(shallowStatus);
    expectType(shallowStatus.value);
    shallowStatus.value = 'invalidating';
}
const refStatus = ref('initial');
if (refStatus.value === 'initial') {
    expectType(shallowStatus);
    expectType(shallowStatus.value);
    refStatus.value = 'invalidating';
}
// proxyRefs: should return `reactive` directly
const r1 = reactive({
    k: 'v'
});
const p1 = proxyRefs(r1);
expectType(p1);
// proxyRefs: `ShallowUnwrapRef`
const r2 = {
    a: ref(1),
    obj: {
        k: ref('foo')
    }
};
const p2 = proxyRefs(r2);
expectType(p2.a);
expectType(p2.obj.k);
// toRef
const obj = {
    a: 1,
    b: ref(1)
};
expectType(toRef(obj, 'a'));
expectType(toRef(obj, 'b'));
// toRefs
const objRefs = toRefs(obj);
expectType(objRefs);
const data = toRefs(reactive({
    state: 'state1'
}));
switch (data.state.value) {
    case 'state1':
        data.state.value = 'state2';
        break;
    case 'state2':
        data.state.value = 'state3';
        break;
    case 'state3':
        data.state.value = 'state1';
        break;
}
