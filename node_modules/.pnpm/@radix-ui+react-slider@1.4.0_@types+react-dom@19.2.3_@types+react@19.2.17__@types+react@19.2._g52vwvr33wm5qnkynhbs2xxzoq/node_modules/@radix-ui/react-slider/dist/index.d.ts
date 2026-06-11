import * as react_jsx_runtime from 'react/jsx-runtime';
import * as _radix_ui_react_context from '@radix-ui/react-context';
import { Scope } from '@radix-ui/react-context';
import * as React from 'react';
import { Primitive } from '@radix-ui/react-primitive';

type Direction = 'ltr' | 'rtl';
declare module 'react' {
    interface CSSProperties {
        [varName: `--radix-${string}`]: string | number | undefined | null;
    }
}
declare global {
    interface FocusOptions {
        /**
         * A boolean value that should be set to `true` to force, or `false` to prevent
         * visible indication that the element is focused. If the property is not
         * specified, a browser will provide visible indication if it determines
         * that this would improve accessibility for users.
         *
         * @see
         * https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/focus#focusvisible
         */
        focusVisible?: boolean;
    }
}
type ScopedProps<P> = P & {
    __scopeSlider?: Scope;
};
declare const createSliderScope: _radix_ui_react_context.CreateScope;
interface SliderProps extends Omit<SliderHorizontalProps | SliderVerticalProps, keyof SliderOrientationPrivateProps | 'defaultValue'> {
    name?: string;
    disabled?: boolean;
    orientation?: React.AriaAttributes['aria-orientation'];
    dir?: Direction;
    min?: number;
    max?: number;
    step?: number;
    minStepsBetweenThumbs?: number;
    value?: number[];
    defaultValue?: number[];
    onValueChange?(value: number[]): void;
    onValueCommit?(value: number[]): void;
    inverted?: boolean;
    form?: string;
}
declare const Slider: React.ForwardRefExoticComponent<SliderProps & React.RefAttributes<HTMLSpanElement>>;
type SliderOrientationPrivateProps = {
    min: number;
    max: number;
    inverted: boolean;
    onSlideStart?(value: number): void;
    onSlideMove?(value: number): void;
    onSlideEnd?(): void;
    onHomeKeyDown(event: React.KeyboardEvent): void;
    onEndKeyDown(event: React.KeyboardEvent): void;
    onStepKeyDown(step: {
        event: React.KeyboardEvent;
        direction: number;
    }): void;
};
interface SliderOrientationProps extends Omit<SliderImplProps, keyof SliderImplPrivateProps>, SliderOrientationPrivateProps {
}
interface SliderHorizontalProps extends SliderOrientationProps {
    dir?: Direction;
}
interface SliderVerticalProps extends SliderOrientationProps {
}
type PrimitiveDivProps = React.ComponentPropsWithoutRef<typeof Primitive.div>;
type SliderImplPrivateProps = {
    onSlideStart(event: React.PointerEvent): void;
    onSlideMove(event: React.PointerEvent): void;
    onSlideEnd(event: React.PointerEvent): void;
    onHomeKeyDown(event: React.KeyboardEvent): void;
    onEndKeyDown(event: React.KeyboardEvent): void;
    onStepKeyDown(event: React.KeyboardEvent): void;
};
interface SliderImplProps extends PrimitiveDivProps, SliderImplPrivateProps {
}
type PrimitiveSpanProps = React.ComponentPropsWithoutRef<typeof Primitive.span>;
interface SliderTrackProps extends PrimitiveSpanProps {
}
declare const SliderTrack: React.ForwardRefExoticComponent<SliderTrackProps & React.RefAttributes<HTMLSpanElement>>;
interface SliderRangeProps extends PrimitiveSpanProps {
}
declare const SliderRange: React.ForwardRefExoticComponent<SliderRangeProps & React.RefAttributes<HTMLSpanElement>>;
interface SliderThumbProviderProps {
    name?: string;
    children?: React.ReactNode;
}
declare function SliderThumbProvider(props: ScopedProps<SliderThumbProviderProps>): react_jsx_runtime.JSX.Element;
declare namespace SliderThumbProvider {
    var displayName: string;
}
interface SliderThumbTriggerProps extends PrimitiveSpanProps {
}
declare const SliderThumbTrigger: React.ForwardRefExoticComponent<SliderThumbTriggerProps & React.RefAttributes<HTMLSpanElement>>;
interface SliderThumbProps extends SliderThumbTriggerProps {
    name?: string;
}
declare const SliderThumb: React.ForwardRefExoticComponent<SliderThumbProps & React.RefAttributes<HTMLSpanElement>>;
type PrimitiveInputProps = React.ComponentPropsWithoutRef<typeof Primitive.input>;
interface SliderBubbleInputProps extends Omit<PrimitiveInputProps, 'value'> {
}
declare const SliderBubbleInput: React.ForwardRefExoticComponent<SliderBubbleInputProps & React.RefAttributes<HTMLInputElement>>;

export { SliderRange as Range, Slider as Root, Slider, type SliderProps, SliderRange, type SliderRangeProps, SliderThumb, type SliderThumbProps, SliderTrack, type SliderTrackProps, SliderThumb as Thumb, SliderTrack as Track, createSliderScope, SliderBubbleInput as unstable_BubbleInput, SliderBubbleInput as unstable_SliderBubbleInput, type SliderBubbleInputProps as unstable_SliderBubbleInputProps, SliderThumbProvider as unstable_SliderThumbProvider, type SliderThumbProviderProps as unstable_SliderThumbProviderProps, SliderThumbTrigger as unstable_SliderThumbTrigger, type SliderThumbTriggerProps as unstable_SliderThumbTriggerProps, SliderThumbProvider as unstable_ThumbProvider, SliderThumbTrigger as unstable_ThumbTrigger };
