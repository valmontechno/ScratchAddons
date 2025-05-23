class FakePointerEvent extends PointerEvent {
  // These events are fired to force Blockly to start a drag gesture.
  // Setting pointerId to an empty string allows any pointerup to end the drag.
  get pointerId() {
    return "";
  }
}

export default class DomHelpers {
  constructor(addon) {
    this.addon = addon;
    this.vm = addon.tab.traps.vm;
    /**
     * @type {eventDetails[]}
     */
    this.events = [];
  }

  /**
   * Simulate a drag and drop programmatically through javascript
   * @param selectorDrag
   * @param selectorDrop
   * @param mouseXY
   * @param [shiftKey=false]
   * @returns {boolean}
   */
  triggerDragAndDrop(selectorDrag, selectorDrop, mouseXY, shiftKey) {
    // function for triggering mouse events - for old Blockly
    shiftKey = shiftKey || false;
    let fireMouseEvent = function (type, elem, centerX, centerY) {
      let evt = document.createEvent("MouseEvents");
      evt.initMouseEvent(type, true, true, window, 1, 1, 1, centerX, centerY, shiftKey, false, false, false, 0, elem);
      elem.dispatchEvent(evt);
    };

    // function for triggering pointer events - for new Blockly
    let firePointerEvent = function (type, elem, centerX, centerY) {
      elem.dispatchEvent(
        new FakePointerEvent(type, {
          bubbles: true,
          clientX: centerX,
          clientY: centerY,
          shiftKey,
        })
      );
    };

    // fetch target elements
    let elemDrag = selectorDrag; // document.querySelector(selectorDrag);
    let elemDrop = selectorDrop; // document.querySelector(selectorDrop);
    if (!elemDrag) {
      return false;
    }

    // calculate positions
    let pos = elemDrag.getBoundingClientRect();
    let center1X = Math.floor((pos.left + pos.right) / 2);
    let center1Y = Math.floor((pos.top + pos.bottom) / 2);

    // mouse over dragged element and mousedown
    fireMouseEvent("mouseover", elemDrag, center1X, center1Y);
    firePointerEvent("pointerover", elemDrag, center1X, center1Y);
    fireMouseEvent("mousedown", elemDrag, center1X, center1Y);
    firePointerEvent("pointerdown", elemDrag, center1X, center1Y);

    // start dragging process over to drop target
    fireMouseEvent("dragstart", elemDrag, center1X, center1Y);
    fireMouseEvent("drag", elemDrag, center1X, center1Y);
    fireMouseEvent("mousemove", elemDrag, center1X, center1Y);
    firePointerEvent("pointermove", elemDrag, center1X, center1Y);

    if (!elemDrop) {
      if (mouseXY) {
        let center2X = mouseXY.x;
        let center2Y = mouseXY.y;
        fireMouseEvent("drag", elemDrag, center2X, center2Y);
        fireMouseEvent("mousemove", elemDrag, center2X, center2Y);
        firePointerEvent("pointermove", elemDrag, center2X, center2Y);
      }
      const workspace = this.addon.tab.traps.getWorkspace();
      if (workspace.getTheme) {
        // New Blockly gets confused when it receives two pointerdown events (the fake one
        // and a real one) without a pointerup in between. Prevent it from canceling
        // the drag gesture when that happens.
        workspace.currentGesture_.gestureHasStarted = false;
        workspace.currentGesture_.handleWsStart = () => {};
      }
      return false;
    }

    pos = elemDrop.getBoundingClientRect();
    let center2X = Math.floor((pos.left + pos.right) / 2);
    let center2Y = Math.floor((pos.top + pos.bottom) / 2);

    fireMouseEvent("drag", elemDrag, center2X, center2Y);
    fireMouseEvent("mousemove", elemDrop, center2X, center2Y);
    firePointerEvent("pointermove", elemDrop, center2X, center2Y);

    // trigger dragging process on top of drop target
    fireMouseEvent("mouseenter", elemDrop, center2X, center2Y);
    firePointerEvent("pointerenter", elemDrop, center2X, center2Y);
    fireMouseEvent("dragenter", elemDrop, center2X, center2Y);
    fireMouseEvent("mouseover", elemDrop, center2X, center2Y);
    firePointerEvent("pointerover", elemDrop, center2X, center2Y);
    fireMouseEvent("dragover", elemDrop, center2X, center2Y);

    // release dragged element on top of drop target
    fireMouseEvent("drop", elemDrop, center2X, center2Y);
    fireMouseEvent("dragend", elemDrag, center2X, center2Y);
    fireMouseEvent("mouseup", elemDrag, center2X, center2Y);
    firePointerEvent("pointerup", elemDrag, center2X, center2Y);

    return true;
  }

  bindOnce(dom, event, func, capture) {
    capture = !!capture;
    dom.removeEventListener(event, func, capture);
    dom.addEventListener(event, func, capture);
    this.events.push(new eventDetails(dom, event, func, capture));
  }

  unbindAllEvents() {
    for (const event of this.events) {
      event.dom.removeEventListener(event.event, event.func, event.capture);
    }
    this.events = [];
  }
}

/**
 * A record of an event
 */
class eventDetails {
  constructor(dom, event, func, capture) {
    this.dom = dom;
    this.event = event;
    this.func = func;
    this.capture = capture;
  }
}
