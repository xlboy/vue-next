import { describe, defineComponent, ref, expectError, expectType } from './index';
describe('object props', () => {
    describe('defineComponent', () => {
        const MyComponent = defineComponent({
            props: {
                a: Number,
                // required should make property non-void
                b: {
                    type: String,
                    required: true
                },
                e: Function,
                // default value should infer type and make it non-void
                bb: {
                    default: 'hello'
                },
                bbb: {
                    // Note: default function value requires arrow syntax + explicit
                    // annotation
                    default: (props) => props.bb || 'foo'
                },
                // explicit type casting
                cc: Array,
                // required + type casting
                dd: {
                    type: Object,
                    required: true
                },
                // return type
                ee: Function,
                // arguments + object return
                ff: Function,
                // explicit type casting with constructor
                ccc: Array,
                // required + contructor type casting
                ddd: {
                    type: Array,
                    required: true
                },
                // required + object return
                eee: {
                    type: Function,
                    required: true
                },
                // required + arguments + object return
                fff: {
                    type: Function,
                    required: true
                },
                hhh: {
                    type: Boolean,
                    required: true
                },
                // default + type casting
                ggg: {
                    type: String,
                    default: 'foo'
                },
                // default + function
                ffff: {
                    type: Function,
                    default: (_a, _b) => ({ a: true })
                },
                validated: {
                    type: String,
                    // validator requires explicit annotation
                    validator: (val) => val !== ''
                }
            },
            setup(props) {
                return {
                    setupA: 1,
                    setupB: ref(1),
                    setupC: {
                        a: ref(2)
                    },
                    setupProps: props
                };
            }
        });
        const { props, rawBindings, setup } = extractComponentOptions(MyComponent);
        // props
        expectType(props.a);
        expectType(props.b);
        expectType(props.e);
        expectType(props.bb);
        expectType(props.bbb);
        expectType(props.cc);
        expectType(props.dd);
        expectType(props.ee);
        expectType(props.ff);
        expectType(props.ccc);
        expectType(props.ddd);
        expectType(props.eee);
        expectType(props.fff);
        expectType(props.hhh);
        expectType(props.ggg);
        expectType(props.ffff);
        expectType(props.validated);
        // raw bindings
        expectType(rawBindings.setupA);
        expectType(rawBindings.setupB);
        expectType(rawBindings.setupC.a);
        expectType(rawBindings.setupA);
        // raw bindings props
        expectType(rawBindings.setupProps.a);
        expectType(rawBindings.setupProps.b);
        expectType(rawBindings.setupProps.e);
        expectType(rawBindings.setupProps.bb);
        expectType(rawBindings.setupProps.bbb);
        expectType(rawBindings.setupProps.cc);
        expectType(rawBindings.setupProps.dd);
        expectType(rawBindings.setupProps.ee);
        expectType(rawBindings.setupProps.ff);
        expectType(rawBindings.setupProps.ccc);
        expectType(rawBindings.setupProps.ddd);
        expectType(rawBindings.setupProps.eee);
        expectType(rawBindings.setupProps.fff);
        expectType(rawBindings.setupProps.hhh);
        expectType(rawBindings.setupProps.ggg);
        expectType(rawBindings.setupProps.ffff);
        expectType(rawBindings.setupProps.validated);
        // setup
        expectType(setup.setupA);
        expectType(setup.setupB);
        expectType(setup.setupC.a);
        expectType(setup.setupA);
        // raw bindings props
        expectType(setup.setupProps.a);
        expectType(setup.setupProps.b);
        expectType(setup.setupProps.e);
        expectType(setup.setupProps.bb);
        expectType(setup.setupProps.bbb);
        expectType(setup.setupProps.cc);
        expectType(setup.setupProps.dd);
        expectType(setup.setupProps.ee);
        expectType(setup.setupProps.ff);
        expectType(setup.setupProps.ccc);
        expectType(setup.setupProps.ddd);
        expectType(setup.setupProps.eee);
        expectType(setup.setupProps.fff);
        expectType(setup.setupProps.hhh);
        expectType(setup.setupProps.ggg);
        expectType(setup.setupProps.ffff);
        expectType(setup.setupProps.validated);
        // instance
        const instance = new MyComponent();
        expectType(instance.setupA);
        // @ts-expect-error
        instance.notExist;
    });
    describe('options', () => {
        const MyComponent = {
            props: {
                a: Number,
                // required should make property non-void
                b: {
                    type: String,
                    required: true
                },
                e: Function,
                // default value should infer type and make it non-void
                bb: {
                    default: 'hello'
                },
                bbb: {
                    // Note: default function value requires arrow syntax + explicit
                    // annotation
                    default: (props) => props.bb || 'foo'
                },
                // explicit type casting
                cc: Array,
                // required + type casting
                dd: {
                    type: Object,
                    required: true
                },
                // return type
                ee: Function,
                // arguments + object return
                ff: Function,
                // explicit type casting with constructor
                ccc: Array,
                // required + contructor type casting
                ddd: {
                    type: Array,
                    required: true
                },
                // required + object return
                eee: {
                    type: Function,
                    required: true
                },
                // required + arguments + object return
                fff: {
                    type: Function,
                    required: true
                },
                hhh: {
                    type: Boolean,
                    required: true
                },
                // default + type casting
                ggg: {
                    type: String,
                    default: 'foo'
                },
                // default + function
                ffff: {
                    type: Function,
                    default: (_a, _b) => ({ a: true })
                },
                validated: {
                    type: String,
                    // validator requires explicit annotation
                    validator: (val) => val !== ''
                }
            },
            setup() {
                return {
                    setupA: 1
                };
            }
        };
        const { props, rawBindings, setup } = extractComponentOptions(MyComponent);
        // props
        expectType(props.a);
        expectType(props.b);
        expectType(props.e);
        expectType(props.bb);
        expectType(props.bbb);
        expectType(props.cc);
        expectType(props.dd);
        expectType(props.ee);
        expectType(props.ff);
        expectType(props.ccc);
        expectType(props.ddd);
        expectType(props.eee);
        expectType(props.fff);
        expectType(props.hhh);
        expectType(props.ggg);
        // expectType<ExpectedProps['ffff']>(props.ffff) // todo fix
        expectType(props.validated);
        // rawBindings
        expectType(rawBindings.setupA);
        //setup
        expectType(setup.setupA);
    });
});
describe('array props', () => {
    describe('defineComponent', () => {
        const MyComponent = defineComponent({
            props: ['a', 'b'],
            setup() {
                return {
                    c: 1
                };
            }
        });
        const { props, rawBindings, setup } = extractComponentOptions(MyComponent);
        // @ts-expect-error props should be readonly
        expectError((props.a = 1));
        expectType(props.a);
        expectType(props.b);
        expectType(rawBindings.c);
        expectType(setup.c);
    });
    describe('options', () => {
        const MyComponent = {
            props: ['a', 'b'],
            setup() {
                return {
                    c: 1
                };
            }
        };
        const { props, rawBindings, setup } = extractComponentOptions(MyComponent);
        // @ts-expect-error props should be readonly
        expectError((props.a = 1));
        // TODO infer the correct keys
        // expectType<any>(props.a)
        // expectType<any>(props.b)
        expectType(rawBindings.c);
        expectType(setup.c);
    });
});
describe('no props', () => {
    describe('defineComponent', () => {
        const MyComponent = defineComponent({
            setup() {
                return {
                    setupA: 1
                };
            }
        });
        const { rawBindings, setup } = extractComponentOptions(MyComponent);
        expectType(rawBindings.setupA);
        expectType(setup.setupA);
        // instance
        const instance = new MyComponent();
        expectType(instance.setupA);
        // @ts-expect-error
        instance.notExist;
    });
    describe('options', () => {
        const MyComponent = {
            setup() {
                return {
                    setupA: 1
                };
            }
        };
        const { rawBindings, setup } = extractComponentOptions(MyComponent);
        expectType(rawBindings.setupA);
        expectType(setup.setupA);
    });
});
describe('functional', () => {
    // TODO `props.foo` is `number|undefined`
    //   describe('defineComponent', () => {
    //     const MyComponent = defineComponent((props: { foo: number }) => {})
    //     const { props } = extractComponentOptions(MyComponent)
    //     expectType<number>(props.foo)
    //   })
    describe('function', () => {
        const MyComponent = (props) => props.foo;
        const { props } = extractComponentOptions(MyComponent);
        expectType(props.foo);
    });
    describe('typed', () => {
        const MyComponent = (_, _2) => { };
        const { props } = extractComponentOptions(MyComponent);
        expectType(props.foo);
    });
});
describe('class', () => {
    const MyComponent = {};
    const { props } = extractComponentOptions(MyComponent);
    expectType(props.foo);
});
