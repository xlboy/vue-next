// TSX w/ defineComponent is tested in defineComponent.test-d.tsx
import { KeepAlive, Suspense, Fragment, Teleport, expectError, expectType } from './index';
expectType(<div />);
expectType(<div id="foo"/>);
expectType(<input value="foo"/>);
// @ts-expect-error unknown prop
expectError(<div foo="bar"/>);
// allow key/ref on arbitrary element
expectType(<div key="foo"/>);
expectType(<div ref="bar"/>);
expectType(<input onInput={e => {
    // infer correct event type
    expectType(e.target);
}}/>);
// built-in types
expectType(<Fragment />);
expectType(<Fragment key="1"/>);
expectType(<Teleport to="#foo"/>);
expectType(<Teleport to="#foo" key="1"/>);
// @ts-expect-error
expectError(<Teleport />);
// @ts-expect-error
expectError(<Teleport to={1}/>);
// KeepAlive
expectType(<KeepAlive include="foo" exclude={['a']}/>);
expectType(<KeepAlive key="1"/>);
// @ts-expect-error
expectError(<KeepAlive include={123}/>);
// Suspense
expectType(<Suspense />);
expectType(<Suspense key="1"/>);
expectType(<Suspense onResolve={() => { }} onFallback={() => { }} onPending={() => { }}/>);
// @ts-expect-error
expectError(<Suspense onResolve={123}/>);
