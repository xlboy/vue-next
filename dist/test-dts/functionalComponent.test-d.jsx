import { expectError, expectType } from './index';
// simple function signature
const Foo = (props) => props.foo;
// TSX
expectType(<Foo foo={1}/>);
expectType(<Foo foo={1} key="1"/>);
expectType(<Foo foo={1} ref="ref"/>);
// @ts-expect-error
expectError(<Foo />);
//  @ts-expect-error
expectError(<Foo foo="bar"/>);
//  @ts-expect-error
expectError(<Foo baz="bar"/>);
// Explicit signature with props + emits
const Bar = (props, { emit }) => {
    expectType(props.foo);
    emit('update', 123);
    //  @ts-expect-error
    expectError(emit('nope'));
    //  @ts-expect-error
    expectError(emit('update'));
    //  @ts-expect-error
    expectError(emit('update', 'nope'));
};
// assigning runtime options
Bar.props = {
    foo: Number
};
//  @ts-expect-error
expectError((Bar.props = { foo: String }));
Bar.emits = {
    update: value => value > 1
};
//  @ts-expect-error
expectError((Bar.emits = { baz: () => void 0 }));
// TSX
expectType(<Bar foo={1}/>);
//  @ts-expect-error
expectError(<Foo />);
//  @ts-expect-error
expectError(<Bar foo="bar"/>);
//  @ts-expect-error
expectError(<Foo baz="bar"/>);
const Baz = (props, { emit }) => {
    expectType(props);
    expectType(emit);
};
expectType(Baz);
const Qux = (props, { emit }) => {
    emit('foo');
    emit('foo', 1, 2);
    emit('bar');
    emit('bar', 1, 2);
};
expectType(Qux);
