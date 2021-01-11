declare module '@xlboy-v3/runtime-core' {
    interface ComponentCustomOptions {
        test?(n: number): void;
    }
    interface ComponentCustomProperties {
        state: 'stopped' | 'running';
    }
    interface ComponentCustomProps {
        custom?: number;
    }
}
export declare const Custom: any;
