/**
 * react-lazyload
 */
import React, { Component } from 'react';
import ReactDom from 'react-dom';
import PropTypes from 'prop-types'; // eslint-disable-line

import lazyload from './decorator';
import { on, off } from './utils/event';
import scrollParent from './utils/scrollParent';
import debounce from './utils/debounce';
import throttle from './utils/throttle';

const defaultBoundingClientRect = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0
};
const LISTEN_FLAG = 'data-lazyload-listened';
const listeners = [];
let pending = [];

// try to handle passive events
let passiveEventSupported = false;
try {
  const opts = Object.defineProperty({}, 'passive', {
    get() {
      passiveEventSupported = true;
    }
  });
  window.addEventListener('test', null, opts);
} catch (e) {}
// if they are supported, setup the optional params
// IMPORTANT: FALSE doubles as the default CAPTURE value!
const passiveEvent = passiveEventSupported
  ? { capture: false, passive: true }
  : false;

const getBoundingOffsets = offset =>
  Array.isArray(offset) ? offset : [offset, offset, offset, offset];

/**
 * Check if `component` is visible in overflow container `parent`
 * @param  {node} component React component
 * @param  {node} parent    component's scroll parent
 * @return {bool}
 */
const checkOverflowVisible = function checkOverflowVisible(component, parent) {
  const node = component.getDOMNode();

  let parentTop;
  let parentLeft;
  let parentHeight;
  let parentWidth;

  try {
    ({
      top: parentTop,
      left: parentLeft,
      height: parentHeight,
      width: parentWidth
    } = parent.getBoundingClientRect());
  } catch (e) {
    ({
      top: parentTop,
      left: parentLeft,
      height: parentHeight,
      width: parentWidth
    } = defaultBoundingClientRect);
  }

  const windowInnerHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const windowInnerWidth =
    window.innerWidth || document.documentElement.clientWidth;

  // calculate top and height of the intersection of the element's scrollParent and viewport
  const intersectionTop = Math.max(parentTop, 0); // intersection's top relative to viewport
  const intersectionLeft = Math.max(parentLeft, 0);
  const intersectionHeight =
    Math.min(windowInnerHeight, parentTop + parentHeight) - intersectionTop; // height
  const intersectionWidth =
    Math.min(windowInnerWidth, parentLeft + parentWidth) - intersectionLeft; // width

  // check whether the element is visible in the intersection
  let top;
  let elementHeight;
  let left;
  let elementWidth;

  try {
    ({
      top,
      height: elementHeight,
      left,
      width: elementWidth
    } = node.getBoundingClientRect());
  } catch (e) {
    ({
      top,
      height: elementHeight,
      left,
      width: elementWidth
    } = defaultBoundingClientRect);
  }

  const offsetTop = top - intersectionTop; // element's top relative to intersection
  const offsetLeft = left - intersectionLeft;

  const offsets = getBoundingOffsets(component.props.offset); // Be compatible with previous API
  const { checkHorizontal } = component.props;

  return (
    offsetTop - offsets[0] <= intersectionHeight &&
    offsetTop + elementHeight + offsets[1] >= 0 &&
    (!checkHorizontal ||
      (offsetLeft - offsets[2] <= intersectionWidth &&
        offsetLeft + elementWidth + offsets[3] >= 0))
  );
};

/**
 * Check if `component` is visible in document
 * @param  {node} component React component
 * @return {bool}
 */
const checkNormalVisible = function checkNormalVisible(component) {
  const node = component.getDOMNode();

  // If this element is hidden by css rules somehow, it's definitely invisible
  if (
    !(node.offsetWidth || node.offsetHeight || node.getClientRects().length)
  ) {
    return false;
  }

  let top;
  let elementHeight;
  let left;
  let elementWidth;

  try {
    ({
      top,
      height: elementHeight,
      left,
      width: elementWidth
    } = node.getBoundingClientRect());
  } catch (e) {
    ({
      top,
      height: elementHeight,
      left,
      width: elementWidth
    } = defaultBoundingClientRect());
  }

  const windowInnerHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const windowInnerWidth =
    window.innerWidth || document.documentElement.clientWidth;

  const offsets = getBoundingOffsets(component.props.offset);
  const { checkHorizontal } = component.props;

  return (
    // vertical check
    top - offsets[0] <= windowInnerHeight &&
    top + elementHeight + offsets[1] >= 0 &&
    // horizontal check
    (!checkHorizontal ||
      (left - offsets[2] <= windowInnerWidth &&
        left + elementWidth + offsets[3] >= 0))
  );
};

/**
 * Detect if element is visible in viewport, if so, set `visible` state to true.
 * If `once` prop is provided true, remove component as listener after checkVisible
 *
 * @param  {React} component   React component that respond to scroll and resize
 */
const checkVisible = function checkVisible(component) {
  const node = component.getDOMNode();

  if (!node) {
    return;
  }

  const parent = scrollParent(node);
  const isOverflow =
    component.props.overflow &&
    parent !== node.ownerDocument &&
    parent !== document &&
    parent !== document.documentElement;

  const visible = isOverflow
    ? checkOverflowVisible(component, parent)
    : checkNormalVisible(component);

  if (visible) {
    // Avoid extra render if previously is visible
    if (!component.visible) {
      if (component.props.once) {
        pending.push(component);
      }

      component.visible = true;
      component.forceUpdate();
    }
  } else if (!(component.props.once && component.visible)) {
    component.visible = false;
    if (component.props.unmountIfInvisible) {
      component.forceUpdate();
    }
  }
};

const purgePending = function purgePending() {
  pending.forEach((component) => {
    const index = listeners.indexOf(component);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  });

  pending = [];
};

const lazyLoadHandler = () => {
  listeners.forEach((listener) => {
    checkVisible(listener);
  });

  // Remove `once` component in listeners
  purgePending();
};

// Depending on component's props
let delayType;
let finalLazyLoadHandler = null;

class LazyLoad extends Component {
  constructor(props) {
    super(props);

    this.visible = false;
  }

  componentDidMount() {
    if (
      typeof process !== 'undefined' &&
      process.env.NODE_ENV !== 'production'
    ) {
      if (React.Children.count(this.props.children) > 1) {
        console.warn(
          '[react-lazyload] Only one child is allowed to be passed to `LazyLoad`.'
        );
      }

      // Warn the user if placeholder and height is not specified and the rendered height is 0
      if (
        !this.props.placeholder &&
        this.props.height === undefined &&
        this.getDOMNode().offsetHeight === 0
      ) {
        console.warn(
          '[react-lazyload] Please add `height` props to <LazyLoad> for better performance.'
        );
      }
    }

    // It's unlikely to change delay type on the fly, this is mainly
    // designed for tests
    let needResetFinalLazyLoadHandler = false;
    if (this.props.debounce !== undefined && delayType === 'throttle') {
      console.warn(
        '[react-lazyload] Previous delay function is `throttle`, now switching to `debounce`, try setting them unanimously'
      );
      needResetFinalLazyLoadHandler = true;
    } else if (delayType === 'debounce' && this.props.debounce === undefined) {
      console.warn(
        '[react-lazyload] Previous delay function is `debounce`, now switching to `throttle`, try setting them unanimously'
      );
      needResetFinalLazyLoadHandler = true;
    }

    if (needResetFinalLazyLoadHandler) {
      off(window, 'scroll', finalLazyLoadHandler, passiveEvent);
      off(window, 'resize', finalLazyLoadHandler, passiveEvent);
      finalLazyLoadHandler = null;
    }

    if (!finalLazyLoadHandler) {
      if (this.props.debounce !== undefined) {
        finalLazyLoadHandler = debounce(
          lazyLoadHandler,
          typeof this.props.debounce === 'number' ? this.props.debounce : 300
        );
        delayType = 'debounce';
      } else if (this.props.throttle !== undefined) {
        finalLazyLoadHandler = throttle(
          lazyLoadHandler,
          typeof this.props.throttle === 'number' ? this.props.throttle : 300
        );
        delayType = 'throttle';
      } else {
        finalLazyLoadHandler = lazyLoadHandler;
      }
    }

    if (this.props.overflow) {
      const parent = scrollParent(this.getDOMNode());

      if (parent && typeof parent.getAttribute === 'function') {
        const listenerCount = 1 + +parent.getAttribute(LISTEN_FLAG);

        if (listenerCount === 1) {
          parent.addEventListener('scroll', finalLazyLoadHandler, passiveEvent);
        }
        parent.setAttribute(LISTEN_FLAG, listenerCount);
      }
    }

    // XXX when we are having overflow container, and it's not yet visible
    // If we don't listen for window scroll
    // -> The lazyload component will not be re-checked when its container is scrolled to the view
    if (listeners.length === 0 || needResetFinalLazyLoadHandler) {
      const { scroll, resize } = this.props;

      if (scroll) {
        on(window, 'scroll', finalLazyLoadHandler, passiveEvent);
      }

      if (resize) {
        on(window, 'resize', finalLazyLoadHandler, passiveEvent);
      }
    }

    if (this.props.checkHorizontal && this.props.offset.length === 2) {
      console.warn(
        '[react-lazyload] To support `checkHorizontal` you need to specify left and right offset, offset format [up, down, left, right]'
      );
    }

    listeners.push(this);
    checkVisible(this);
  }

  shouldComponentUpdate() {
    return this.visible;
  }

  componentWillUnmount() {
    if (this.props.overflow) {
      const parent = scrollParent(this.getDOMNode());

      if (parent && typeof parent.getAttribute === 'function') {
        const listenerCount = +parent.getAttribute(LISTEN_FLAG) - 1;
        if (listenerCount === 0) {
          parent.removeEventListener(
            'scroll',
            finalLazyLoadHandler,
            passiveEvent
          );
          parent.removeAttribute(LISTEN_FLAG);
        } else {
          parent.setAttribute(LISTEN_FLAG, listenerCount);
        }
      }
    }

    const index = listeners.indexOf(this);
    if (index !== -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0) {
      off(window, 'resize', finalLazyLoadHandler, passiveEvent);
      off(window, 'scroll', finalLazyLoadHandler, passiveEvent);
    }
  }

  getDOMNode() {
    return ReactDom.findDOMNode(this); // eslint-disable-line
  }

  render() {
    const { placeholder, children, height } = this.props;

    return this.visible
      ? children
      : placeholder || (
      <div
        ref={(el) => {
          this.domNode = el;
        }}
        style={{ height }}
        className="lazyload-placeholder"
      />
        );
  }
}

LazyLoad.propTypes = {
  once: PropTypes.bool,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  offset: PropTypes.oneOfType([
    PropTypes.number,
    PropTypes.arrayOf(PropTypes.number)
  ]),
  overflow: PropTypes.bool,
  resize: PropTypes.bool,
  scroll: PropTypes.bool,
  children: PropTypes.node,
  throttle: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
  debounce: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
  placeholder: PropTypes.node,
  unmountIfInvisible: PropTypes.bool,
  checkHorizontal: PropTypes.bool
};

LazyLoad.defaultProps = {
  once: false,
  offset: 0,
  overflow: false,
  resize: false,
  scroll: true,
  unmountIfInvisible: false,
  checkHorizontal: false
};

export default LazyLoad;
export { lazyLoadHandler as forceCheck, lazyload };
