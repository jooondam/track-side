// the scene loads a GLB through <Suspense fallback={null}> and compiles its shaders on first
// draw. Both can fail, and a failure inside the Canvas unmounts the tree without unmounting the
// page, so until now the whole 3D view could disappear in total silence and leave the HUD sitting
// over an empty rectangle.
//
// Error boundaries have to be class components: there is no hook equivalent.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AppState } from "./AppState";

interface Props {
  children: ReactNode;
  /** shown as the card's headline, so the reader knows which circuit died */
  title: string;
}

interface State {
  message: string | null;
}

export class SceneBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // the boundary swallows the render, so without this the stack never reaches the console and
    // the failure is undebuggable from a user's report
    console.error("scene failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.message !== null) {
      return (
        <AppState
          kind="error"
          title={this.props.title}
          message="The circuit loaded, but the 3D view could not be drawn. Redrawing sometimes clears it; if it does not, the browser is likely out of graphics memory."
          detail={this.state.message}
          onRetry={() => this.setState({ message: null })}
          retryLabel="Redraw the scene"
        />
      );
    }
    return this.props.children;
  }
}
