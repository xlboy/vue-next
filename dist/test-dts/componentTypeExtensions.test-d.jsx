import { defineComponent, expectError, expectType } from './index';
export const Custom = defineComponent({
    props: {
        bar: String,
        baz: {
            type: Number,
            required: true
        }
    },
    data: () => ({ counter: 0 }),
    test(n) {
        expectType(n);
    },
    methods: {
        aMethod() {
            // @ts-expect-error
            expectError(this.notExisting);
            this.counter++;
            this.state = 'running';
            // @ts-expect-error
            expectError((this.state = 'not valid'));
        }
    }
});
expectType(<Custom baz={1}/>);
expectType(<Custom custom={1} baz={1}/>);
expectType(<Custom bar="bar" baz={1}/>);
// @ts-expect-error
expectType(<Custom />);
// @ts-expect-error
expectError(<Custom bar="bar"/>);
// @ts-expect-error
expectError(<Custom baz="baz"/>);
// @ts-expect-error
expectError(<Custom baz={1} notExist={1}/>);
// @ts-expect-error
expectError(<Custom baz={1} custom="custom"/>);
