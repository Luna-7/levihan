declare module 'react-pinch-zoom-pan' {
  import * as React from 'react';

  export interface ReactPinchZoomPanProps {
    render: (obj: { x: string; y: string; scale: string }) => React.ReactNode;
    initialScale?: number;
    maxScale?: number;
    onPinchStart?: () => void;
    onPinchStop?: () => void;
    children?: React.ReactNode;
  }

  export interface PinchViewProps {
    initialScale?: number;
    maxScale?: number;
    containerRatio?: number;
    backgroundColor?: string;
    holderClassName?: string;
    containerClassName?: string;
    debug?: boolean;
    onPinchStart?: () => void;
    onPinchStop?: () => void;
    children?: React.ReactNode;
  }

  export class ReactPinchZoomPan extends React.Component<ReactPinchZoomPanProps> {}
  export class PinchView extends React.Component<PinchViewProps> {}

  export default ReactPinchZoomPan;
}
