import { ref, computed, watch, expectType } from './index';
const source = ref('foo');
const source2 = computed(() => source.value);
const source3 = () => 1;
// lazy watcher will have consistent types for oldValue.
watch(source, (value, oldValue) => {
    expectType(value);
    expectType(oldValue);
});
watch([source, source2, source3], (values, oldValues) => {
    expectType(values);
    expectType(oldValues);
});
// const array
watch([source, source2, source3], (values, oldValues) => {
    expectType(values);
    expectType(oldValues);
});
// immediate watcher's oldValue will be undefined on first run.
watch(source, (value, oldValue) => {
    expectType(value);
    expectType(oldValue);
}, { immediate: true });
watch([source, source2, source3], (values, oldValues) => {
    expectType(values);
    expectType(oldValues);
}, { immediate: true });
// const array
watch([source, source2, source3], (values, oldValues) => {
    expectType(values);
    expectType(oldValues);
}, { immediate: true });
// should provide correct ref.value inner type to callbacks
const nestedRefSource = ref({
    foo: ref(1)
});
watch(nestedRefSource, (v, ov) => {
    expectType(v);
    expectType(ov);
});
const someRef = ref({ test: 'test' });
const otherRef = ref({ a: 'b' });
watch([someRef, otherRef], values => {
    const value1 = values[0];
    // no type error
    console.log(value1.test);
    const value2 = values[1];
    // no type error
    console.log(value2.a);
});
