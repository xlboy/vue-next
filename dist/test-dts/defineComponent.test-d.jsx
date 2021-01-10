import { describe, defineComponent, ref, reactive, createApp, expectError, expectType, h } from './index';
describe('with object props', () => {
    const MyComponent = defineComponent({
        props: {
            a: Number,
            // required should make property non-void
            b: {
                type: String,
                required: true
            },
            e: Function,
            h: Boolean,
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
                default: (a, b) => ({ a: a > +b })
            },
            validated: {
                type: String,
                // validator requires explicit annotation
                validator: (val) => val !== ''
            }
        },
        setup(props) {
            // type assertion. See https://github.com/SamVerschueren/tsd
            expectType(props.a);
            expectType(props.b);
            expectType(props.e);
            expectType(props.h);
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
            // @ts-expect-error props should be readonly
            expectError((props.a = 1));
            // setup context
            return {
                c: ref(1),
                d: {
                    e: ref('hi')
                },
                f: reactive({
                    g: ref('hello')
                })
            };
        },
        render() {
            const props = this.$props;
            expectType(props.a);
            expectType(props.b);
            expectType(props.e);
            expectType(props.h);
            expectType(props.bb);
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
            // @ts-expect-error props should be readonly
            expectError((props.a = 1));
            // should also expose declared props on `this`
            expectType(this.a);
            expectType(this.b);
            expectType(this.e);
            expectType(this.h);
            expectType(this.bb);
            expectType(this.cc);
            expectType(this.dd);
            expectType(this.ee);
            expectType(this.ff);
            expectType(this.ccc);
            expectType(this.ddd);
            expectType(this.eee);
            expectType(this.fff);
            expectType(this.hhh);
            expectType(this.ggg);
            // @ts-expect-error props on `this` should be readonly
            expectError((this.a = 1));
            // assert setup context unwrapping
            expectType(this.c);
            expectType(this.d.e.value);
            expectType(this.f.g);
            // setup context properties should be mutable
            this.c = 2;
            return null;
        }
    });
    expectType(MyComponent);
    // Test TSX
    expectType(<MyComponent a={1} b="b" bb="bb" e={() => { }} cc={['cc']} dd={{ n: 1 }} ee={() => 'ee'} ccc={['ccc']} ddd={['ddd']} eee={() => ({ a: 'eee' })} fff={(a, b) => ({ a: a > +b })} hhh={false} ggg="foo" 
    // should allow class/style as attrs
    class="bar" style={{ color: 'red' }} 
    // should allow key
    key={'foo'} 
    // should allow ref
    ref={'foo'}/>);
    expectType(<MyComponent b="b" dd={{ n: 1 }} ddd={['ddd']} eee={() => ({ a: 'eee' })} fff={(a, b) => ({ a: a > +b })} hhh={false}/>);
    // @ts-expect-error missing required props
    expectError(<MyComponent />);
    expectError(
    // @ts-expect-error wrong prop types
    <MyComponent a={'wrong type'} b="foo" dd={{ n: 1 }} ddd={['foo']}/>);
    expectError(
    // @ts-expect-error wrong prop types
    <MyComponent ggg="baz"/>);
    // @ts-expect-error
    expectError(<MyComponent b="foo" dd={{ n: 'string' }} ddd={['foo']}/>);
    // `this` should be void inside of prop validators and prop default factories
    defineComponent({
        props: {
            myProp: {
                type: Number,
                validator(val) {
                    // @ts-expect-error
                    return val !== this.otherProp;
                },
                default() {
                    // @ts-expect-error
                    return this.otherProp + 1;
                }
            },
            otherProp: {
                type: Number,
                required: true
            }
        }
    });
});
// describe('type inference w/ optional props declaration', () => {
//   const MyComponent = defineComponent({
//     setup(_props: { msg: string }) {
//       return {
//         a: 1
//       }
//     },
//     render() {
//       expectType<string>(this.$props.msg)
//       // props should be readonly
//       expectError((this.$props.msg = 'foo'))
//       // should not expose on `this`
//       expectError(this.msg)
//       expectType<number>(this.a)
//       return null
//     }
//   })
//   expectType<JSX.Element>(<MyComponent msg="foo" />)
//   expectError(<MyComponent />)
//   expectError(<MyComponent msg={1} />)
// })
// describe('type inference w/ direct setup function', () => {
//   const MyComponent = defineComponent((_props: { msg: string }) => {})
//   expectType<JSX.Element>(<MyComponent msg="foo" />)
//   expectError(<MyComponent />)
//   expectError(<MyComponent msg={1} />)
// })
describe('type inference w/ array props declaration', () => {
    const MyComponent = defineComponent({
        props: ['a', 'b'],
        setup(props) {
            // @ts-expect-error props should be readonly
            expectError((props.a = 1));
            expectType(props.a);
            expectType(props.b);
            return {
                c: 1
            };
        },
        render() {
            expectType(this.$props.a);
            expectType(this.$props.b);
            // @ts-expect-error
            expectError((this.$props.a = 1));
            expectType(this.a);
            expectType(this.b);
            expectType(this.c);
        }
    });
    expectType(<MyComponent a={[1, 2]} b="b"/>);
    // @ts-expect-error
    expectError(<MyComponent other="other"/>);
});
describe('type inference w/ options API', () => {
    defineComponent({
        props: { a: Number },
        setup() {
            return {
                b: 123
            };
        },
        data() {
            // Limitation: we cannot expose the return result of setup() on `this`
            // here in data() - somehow that would mess up the inference
            expectType(this.a);
            return {
                c: this.a || 123
            };
        },
        computed: {
            d() {
                expectType(this.b);
                return this.b + 1;
            },
            e: {
                get() {
                    expectType(this.b);
                    expectType(this.d);
                    return this.b + this.d;
                },
                set(v) {
                    expectType(this.b);
                    expectType(this.d);
                    expectType(v);
                }
            }
        },
        watch: {
            a() {
                expectType(this.b);
                this.b + 1;
            }
        },
        created() {
            // props
            expectType(this.a);
            // returned from setup()
            expectType(this.b);
            // returned from data()
            expectType(this.c);
            // computed
            expectType(this.d);
            // computed get/set
            expectType(this.e);
        },
        methods: {
            doSomething() {
                // props
                expectType(this.a);
                // returned from setup()
                expectType(this.b);
                // returned from data()
                expectType(this.c);
                // computed
                expectType(this.d);
                // computed get/set
                expectType(this.e);
            },
            returnSomething() {
                return this.a;
            }
        },
        render() {
            // props
            expectType(this.a);
            // returned from setup()
            expectType(this.b);
            // returned from data()
            expectType(this.c);
            // computed
            expectType(this.d);
            // computed get/set
            expectType(this.e);
            // method
            expectType(this.returnSomething);
        }
    });
});
describe('with mixins', () => {
    const MixinA = defineComponent({
        props: {
            aP1: {
                type: String,
                default: 'aP1'
            },
            aP2: Boolean
        },
        data() {
            return {
                a: 1
            };
        }
    });
    const MixinB = defineComponent({
        props: ['bP1', 'bP2'],
        data() {
            return {
                b: 2
            };
        }
    });
    const MixinC = defineComponent({
        data() {
            return {
                c: 3
            };
        }
    });
    const MixinD = defineComponent({
        mixins: [MixinA],
        data() {
            //@ts-expect-error computed are not available on data()
            expectError(this.dC1);
            //@ts-expect-error computed are not available on data()
            expectError(this.dC2);
            return {
                d: 4
            };
        },
        setup(props) {
            expectType(props.aP1);
        },
        computed: {
            dC1() {
                return this.d + this.a;
            },
            dC2() {
                return this.aP1 + 'dC2';
            }
        }
    });
    const MyComponent = defineComponent({
        mixins: [MixinA, MixinB, MixinC, MixinD],
        props: {
            // required should make property non-void
            z: {
                type: String,
                required: true
            }
        },
        data(vm) {
            expectType(vm.a);
            expectType(vm.b);
            expectType(vm.c);
            expectType(vm.d);
            // should also expose declared props on `this`
            expectType(this.a);
            expectType(this.aP1);
            expectType(this.aP2);
            expectType(this.b);
            expectType(this.bP1);
            expectType(this.c);
            expectType(this.d);
            return {};
        },
        setup(props) {
            expectType(props.z);
            // props
            expectType(props.aP1);
            expectType(props.aP2);
            expectType(props.bP1);
            expectType(props.bP2);
            expectType(props.z);
        },
        render() {
            const props = this.$props;
            // props
            expectType(props.aP1);
            expectType(props.aP2);
            expectType(props.bP1);
            expectType(props.bP2);
            expectType(props.z);
            const data = this.$data;
            expectType(data.a);
            expectType(data.b);
            expectType(data.c);
            expectType(data.d);
            // should also expose declared props on `this`
            expectType(this.a);
            expectType(this.aP1);
            expectType(this.aP2);
            expectType(this.b);
            expectType(this.bP1);
            expectType(this.c);
            expectType(this.d);
            expectType(this.dC1);
            expectType(this.dC2);
            // props should be readonly
            // @ts-expect-error
            expectError((this.aP1 = 'new'));
            // @ts-expect-error
            expectError((this.z = 1));
            // props on `this` should be readonly
            // @ts-expect-error
            expectError((this.bP1 = 1));
            // string value can not assigned to number type value
            // @ts-expect-error
            expectError((this.c = '1'));
            // setup context properties should be mutable
            this.d = 5;
            return null;
        }
    });
    // Test TSX
    expectType(<MyComponent aP1={'aP'} aP2 bP1={1} bP2={[1, 2]} z={'z'}/>);
    // missing required props
    // @ts-expect-error
    expectError(<MyComponent />);
    // wrong prop types
    // @ts-expect-error
    expectError(<MyComponent aP1="ap" aP2={'wrong type'} bP1="b" z={'z'}/>);
    // @ts-expect-error
    expectError(<MyComponent aP1={1} bP2={[1]}/>);
});
describe('with extends', () => {
    const Base = defineComponent({
        props: {
            aP1: Boolean,
            aP2: {
                type: Number,
                default: 2
            }
        },
        data() {
            return {
                a: 1
            };
        },
        computed: {
            c() {
                return this.aP2 + this.a;
            }
        }
    });
    const MyComponent = defineComponent({
        extends: Base,
        props: {
            // required should make property non-void
            z: {
                type: String,
                required: true
            }
        },
        render() {
            const props = this.$props;
            // props
            expectType(props.aP1);
            expectType(props.aP2);
            expectType(props.z);
            const data = this.$data;
            expectType(data.a);
            // should also expose declared props on `this`
            expectType(this.a);
            expectType(this.aP1);
            expectType(this.aP2);
            // setup context properties should be mutable
            this.a = 5;
            return null;
        }
    });
    // Test TSX
    expectType(<MyComponent aP2={3} aP1 z={'z'}/>);
    // missing required props
    // @ts-expect-error
    expectError(<MyComponent />);
    // wrong prop types
    // @ts-expect-error
    expectError(<MyComponent aP2={'wrong type'} z={'z'}/>);
    // @ts-expect-error
    expectError(<MyComponent aP1={3}/>);
});
describe('extends with mixins', () => {
    const Mixin = defineComponent({
        props: {
            mP1: {
                type: String,
                default: 'mP1'
            },
            mP2: Boolean,
            mP3: {
                type: Boolean,
                required: true
            }
        },
        data() {
            return {
                a: 1
            };
        }
    });
    const Base = defineComponent({
        props: {
            p1: Boolean,
            p2: {
                type: Number,
                default: 2
            },
            p3: {
                type: Boolean,
                required: true
            }
        },
        data() {
            return {
                b: 2
            };
        },
        computed: {
            c() {
                return this.p2 + this.b;
            }
        }
    });
    const MyComponent = defineComponent({
        extends: Base,
        mixins: [Mixin],
        props: {
            // required should make property non-void
            z: {
                type: String,
                required: true
            }
        },
        render() {
            const props = this.$props;
            // props
            expectType(props.p1);
            expectType(props.p2);
            expectType(props.z);
            expectType(props.mP1);
            expectType(props.mP2);
            const data = this.$data;
            expectType(data.a);
            expectType(data.b);
            // should also expose declared props on `this`
            expectType(this.a);
            expectType(this.b);
            expectType(this.p1);
            expectType(this.p2);
            expectType(this.mP1);
            expectType(this.mP2);
            // setup context properties should be mutable
            this.a = 5;
            return null;
        }
    });
    // Test TSX
    expectType(<MyComponent mP1="p1" mP2 mP3 p1 p2={1} p3 z={'z'}/>);
    // mP1, mP2, p1, and p2 have default value. these are not required
    expectType(<MyComponent mP3 p3 z={'z'}/>);
    // missing required props
    // @ts-expect-error
    expectError(<MyComponent mP3 p3 /* z='z' *//>);
    // missing required props from mixin
    // @ts-expect-error
    expectError(<MyComponent /* mP3 */ p3 z="z"/>);
    // missing required props from extends
    // @ts-expect-error
    expectError(<MyComponent mP3 /* p3 */ z="z"/>);
    // wrong prop types
    // @ts-expect-error
    expectError(<MyComponent p2={'wrong type'} z={'z'}/>);
    // @ts-expect-error
    expectError(<MyComponent mP1={3}/>);
});
describe('compatibility w/ createApp', () => {
    const comp = defineComponent({});
    createApp(comp).mount('#hello');
    const comp2 = defineComponent({
        props: { foo: String }
    });
    createApp(comp2).mount('#hello');
    const comp3 = defineComponent({
        setup() {
            return {
                a: 1
            };
        }
    });
    createApp(comp3).mount('#hello');
});
describe('defineComponent', () => {
    test('should accept components defined with defineComponent', () => {
        const comp = defineComponent({});
        defineComponent({
            components: { comp }
        });
    });
    test('should accept class components with receiving constructor arguments', () => {
        class Comp {
            constructor(_props) { }
        }
        Comp.__vccOpts = {};
        defineComponent({
            components: { Comp }
        });
    });
});
describe('emits', () => {
    // Note: for TSX inference, ideally we want to map emits to onXXX props,
    // but that requires type-level string constant concatenation as suggested in
    // https://github.com/Microsoft/TypeScript/issues/12754
    // The workaround for TSX users is instead of using emits, declare onXXX props
    // and call them instead. Since `v-on:click` compiles to an `onClick` prop,
    // this would also support other users consuming the component in templates
    // with `v-on` listeners.
    // with object emits
    defineComponent({
        emits: {
            click: (n) => typeof n === 'number',
            input: (b) => b.length > 1
        },
        setup(props, { emit }) {
            emit('click', 1);
            emit('input', 'foo');
            //  @ts-expect-error
            expectError(emit('nope'));
            //  @ts-expect-error
            expectError(emit('click'));
            //  @ts-expect-error
            expectError(emit('click', 'foo'));
            //  @ts-expect-error
            expectError(emit('input'));
            //  @ts-expect-error
            expectError(emit('input', 1));
        },
        created() {
            this.$emit('click', 1);
            this.$emit('input', 'foo');
            //  @ts-expect-error
            expectError(this.$emit('nope'));
            //  @ts-expect-error
            expectError(this.$emit('click'));
            //  @ts-expect-error
            expectError(this.$emit('click', 'foo'));
            //  @ts-expect-error
            expectError(this.$emit('input'));
            //  @ts-expect-error
            expectError(this.$emit('input', 1));
        }
    });
    // with array emits
    defineComponent({
        emits: ['foo', 'bar'],
        setup(props, { emit }) {
            emit('foo');
            emit('foo', 123);
            emit('bar');
            //  @ts-expect-error
            expectError(emit('nope'));
        },
        created() {
            this.$emit('foo');
            this.$emit('foo', 123);
            this.$emit('bar');
            //  @ts-expect-error
            expectError(this.$emit('nope'));
        }
    });
    // without emits
    defineComponent({
        setup(props, { emit }) {
            emit('test', 1);
            emit('test');
        }
    });
    // emit should be valid when ComponentPublicInstance is used.
    const instance = {};
    instance.$emit('test', 1);
    instance.$emit('test');
    // `this` should be void inside of emits validators
    defineComponent({
        props: ['bar'],
        emits: {
            foo() {
                // @ts-expect-error
                return this.bar === 3;
            }
        }
    });
});
describe('componentOptions setup should be `SetupContext`', () => {
    expect({});
});
describe('extract instance type', () => {
    const Base = defineComponent({
        props: {
            baseA: {
                type: Number,
                default: 1
            }
        }
    });
    const MixinA = defineComponent({
        props: {
            mA: {
                type: String,
                default: ''
            }
        }
    });
    const CompA = defineComponent({
        extends: Base,
        mixins: [MixinA],
        props: {
            a: {
                type: Boolean,
                default: false
            },
            b: {
                type: String,
                required: true
            },
            c: Number
        }
    });
    const compA = {};
    expectType(compA.a);
    expectType(compA.b);
    expectType(compA.c);
    // mixins
    expectType(compA.mA);
    // extends
    expectType(compA.baseA);
    //  @ts-expect-error
    expectError((compA.a = true));
    //  @ts-expect-error
    expectError((compA.b = 'foo'));
    //  @ts-expect-error
    expectError((compA.c = 1));
    //  @ts-expect-error
    expectError((compA.mA = 'foo'));
    //  @ts-expect-error
    expectError((compA.baseA = 1));
});
describe('async setup', () => {
    const Comp = defineComponent({
        async setup() {
            // setup context
            return {
                a: ref(1),
                b: {
                    c: ref('hi')
                },
                d: reactive({
                    e: ref('hello')
                })
            };
        },
        render() {
            // assert setup context unwrapping
            expectType(this.a);
            expectType(this.b.c.value);
            expectType(this.d.e);
            // setup context properties should be mutable
            this.a = 2;
        }
    });
    const vm = {};
    // assert setup context unwrapping
    expectType(vm.a);
    expectType(vm.b.c.value);
    expectType(vm.d.e);
    // setup context properties should be mutable
    vm.a = 2;
});
// check if defineComponent can be exported
export default {
    // function components
    a: defineComponent(_ => h('div')),
    // no props
    b: defineComponent({
        data() {
            return {};
        }
    }),
    c: defineComponent({
        props: ['a']
    }),
    d: defineComponent({
        props: {
            a: Number
        }
    })
};
