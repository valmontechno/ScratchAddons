import downloadBlob from "../../libraries/common/cs/download-blob.js";

export default async ({ addon, console, msg }) => {
  const MAX_RECORD_TIME = 600; // seconds
  const DEFAULT_SETTINGS = {
    secs: 30,
    delay: 0,
    audioEnabled: true,
    micEnabled: false,
    waitUntilFlag: true,
    useStopSign: true,
  };
  const LOCALSTORAGE_ENTRY = "sa-record-options";

  let isRecording = false;
  let isWaitingForFlag = false;
  let waitingForFlagFunc = null;
  let abortController = null;
  let stopSignFunc = null;
  let recordBuffer = [];
  let recorder;
  let timeout;

  let recordElem;

  const getStoredOptions = () => {
    try {
      return Object.assign(
        JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
        JSON.parse(localStorage.getItem(LOCALSTORAGE_ENTRY))
      );
    } catch {
      return DEFAULT_SETTINGS;
    }
  };

  const mimeType = [
    // Prefer mp4 format over webm (Chrome and Safari)
    "video/mp4; codecs=mp4a.40.2",
    "video/mp4",
    // Chrome 125 and below and Firefox only support encoding as webm
    // VP9 is preferred as its playback is better supported across platforms
    "video/webm; codecs=vp9",
    // Firefox only supports encoding VP8
    "video/webm",
  ].find((i) => MediaRecorder.isTypeSupported(i));
  const fileExtension = mimeType.split(";")[0].split("/")[1];

  while (true) {
    const referenceElem = await addon.tab.waitForElement(
      'div[class*="menu-bar_file-group"] > div:last-child:not(.sa-record)',
      {
        markAsSeen: true,
        reduxEvents: [
          "scratch-gui/mode/SET_PLAYER",
          "fontsLoaded/SET_FONTS_LOADED",
          "scratch-gui/locales/SELECT_LOCALE",
        ],
      }
    );

    // Options modal
    const getOptions = () => {
      const storedOptions = getStoredOptions();
      const { backdrop, container, content, closeButton, remove } = addon.tab.createModal(msg("option-title"), {
        isOpen: true,
        useEditorClasses: true,
      });
      container.classList.add("mediaRecorderPopup");
      content.classList.add("mediaRecorderPopupContent");

      const recordOptionDescription = Object.assign(document.createElement("p"), {
        textContent: msg("record-description", {
          extension: `.${fileExtension}`,
        }),
        className: "recordOptionDescription",
      });
      recordOptionDescription.appendChild(
        Object.assign(document.createElement("p"), {
          textContent: msg("record-note"),
          className: "recordOptionNote",
        })
      );
      content.appendChild(recordOptionDescription);

      // Create settings elements
      // Delay before starting
      const recordOptionDelay = document.createElement("p");
      const recordOptionDelayInput = Object.assign(document.createElement("input"), {
        type: "number",
        min: 0,
        max: MAX_RECORD_TIME,
        defaultValue: storedOptions.delay,
        id: "recordOptionDelayInput",
        className: addon.tab.scratchClass("prompt_variable-name-text-input"),
      });
      const recordOptionDelayLabel = Object.assign(document.createElement("label"), {
        htmlFor: "recordOptionDelayInput",
        textContent: msg("start-delay"),
      });
      recordOptionDelay.appendChild(recordOptionDelayLabel);
      recordOptionDelay.appendChild(recordOptionDelayInput);
      recordOptionDelay.appendChild(
        Object.assign(document.createElement("span"), {
          textContent: msg("seconds"),
        })
      );
      content.appendChild(recordOptionDelay);

      // Wait for green flag
      const recordOptionFlag = Object.assign(document.createElement("p"), {
        className: "mediaRecorderPopupOption",
      });
      const recordOptionFlagInput = Object.assign(document.createElement("input"), {
        type: "checkbox",
        defaultChecked: storedOptions.waitUntilFlag,
        id: "recordOptionFlagInput",
      });
      const recordOptionFlagLabel = Object.assign(document.createElement("label"), {
        htmlFor: "recordOptionFlagInput",
        textContent: msg("record-after-flag"),
      });
      recordOptionFlag.appendChild(recordOptionFlagInput);
      recordOptionFlag.appendChild(recordOptionFlagLabel);
      content.appendChild(recordOptionFlag);

      content.appendChild(
        Object.assign(document.createElement("div"), {
          className: "mediaRecorderSeparator",
        })
      );

      // Recording length
      const recordOptionSeconds = document.createElement("p");
      const recordOptionSecondsInput = Object.assign(document.createElement("input"), {
        type: "number",
        min: 1,
        max: MAX_RECORD_TIME,
        defaultValue: storedOptions.secs,
        id: "recordOptionSecondsInput",
        className: addon.tab.scratchClass("prompt_variable-name-text-input"),
      });
      const recordOptionSecondsLabel = Object.assign(document.createElement("label"), {
        htmlFor: "recordOptionSecondsInput",
        textContent: msg("record-duration"),
      });
      recordOptionSeconds.appendChild(recordOptionSecondsLabel);
      recordOptionSeconds.appendChild(recordOptionSecondsInput);
      recordOptionSeconds.appendChild(
        Object.assign(document.createElement("span"), {
          textContent: msg("seconds"),
        })
      );
      content.appendChild(recordOptionSeconds);

      // End on stop sign
      const recordOptionStop = Object.assign(document.createElement("p"), {
        className: "mediaRecorderPopupOption",
      });
      const recordOptionStopInput = Object.assign(document.createElement("input"), {
        type: "checkbox",
        defaultChecked: storedOptions.useStopSign,
        id: "recordOptionStopInput",
      });
      const recordOptionStopLabel = Object.assign(document.createElement("label"), {
        htmlFor: "recordOptionStopInput",
        textContent: msg("record-until-stop"),
      });
      let wasStopInputChecked = storedOptions.useStopSign;
      const onFlagInputToggle = () => {
        const disabled = (recordOptionStopInput.disabled = !recordOptionFlagInput.checked);
        if (disabled) {
          wasStopInputChecked = recordOptionStopInput.checked;
          recordOptionStopLabel.title = msg("record-until-stop-disabled", {
            afterFlagOption: msg("record-after-flag"),
          });
          recordOptionStopInput.checked = false;
        } else {
          recordOptionStopLabel.title = "";
          recordOptionStopInput.checked = wasStopInputChecked;
        }
      };
      recordOptionFlagInput.addEventListener("change", onFlagInputToggle);
      onFlagInputToggle(); // The option could be unchecked to begin with
      recordOptionStop.appendChild(recordOptionStopInput);
      recordOptionStop.appendChild(recordOptionStopLabel);
      content.appendChild(recordOptionStop);

      content.appendChild(
        Object.assign(document.createElement("div"), {
          className: "mediaRecorderSeparator",
        })
      );

      // Audio enabled
      const recordOptionAudio = Object.assign(document.createElement("p"), {
        className: "mediaRecorderPopupOption",
      });
      const recordOptionAudioInput = Object.assign(document.createElement("input"), {
        type: "checkbox",
        defaultChecked: storedOptions.audioEnabled,
        id: "recordOptionAudioInput",
      });
      const recordOptionAudioLabel = Object.assign(document.createElement("label"), {
        htmlFor: "recordOptionAudioInput",
        textContent: msg("record-audio"),
        title: msg("record-audio-description"),
      });
      recordOptionAudio.appendChild(recordOptionAudioInput);
      recordOptionAudio.appendChild(recordOptionAudioLabel);
      content.appendChild(recordOptionAudio);

      // Mic enabled
      const recordOptionMic = Object.assign(document.createElement("p"), {
        className: "mediaRecorderPopupOption",
      });
      const recordOptionMicInput = Object.assign(document.createElement("input"), {
        type: "checkbox",
        defaultChecked: storedOptions.micEnabled,
        id: "recordOptionMicInput",
      });
      const recordOptionMicLabel = Object.assign(document.createElement("label"), {
        htmlFor: "recordOptionMicInput",
        textContent: msg("record-mic"),
      });
      recordOptionMic.appendChild(recordOptionMicInput);
      recordOptionMic.appendChild(recordOptionMicLabel);
      content.appendChild(recordOptionMic);

      let resolvePromise = null;
      const optionPromise = new Promise((resolve) => {
        resolvePromise = resolve;
      });
      let handleOptionClose = null;

      backdrop.addEventListener("click", () => handleOptionClose(null));
      closeButton.addEventListener("click", () => handleOptionClose(null));

      handleOptionClose = (value) => {
        resolvePromise(value);
        remove();
      };

      const buttonRow = Object.assign(document.createElement("div"), {
        className: addon.tab.scratchClass("prompt_button-row", { others: "mediaRecorderPopupButtons" }),
      });
      const cancelButton = Object.assign(document.createElement("button"), {
        textContent: msg("cancel"),
      });
      cancelButton.addEventListener("click", () => handleOptionClose(null), { once: true });
      buttonRow.appendChild(cancelButton);
      const startButton = Object.assign(document.createElement("button"), {
        textContent: msg("start"),
        className: addon.tab.scratchClass("prompt_ok-button"),
      });
      startButton.addEventListener(
        "click",
        () =>
          handleOptionClose({
            secs: Math.min(Number(recordOptionSecondsInput.value), MAX_RECORD_TIME),
            delay: Math.min(Number(recordOptionDelayInput.value), MAX_RECORD_TIME),
            audioEnabled: recordOptionAudioInput.checked,
            micEnabled: recordOptionMicInput.checked,
            waitUntilFlag: recordOptionFlagInput.checked,
            useStopSign: !recordOptionStopInput.disabled && recordOptionStopInput.checked,
          }),
        { once: true }
      );
      buttonRow.appendChild(startButton);
      content.appendChild(buttonRow);

      return optionPromise;
    };
    const disposeRecorder = () => {
      isRecording = false;
      recordElem.textContent = msg("record");
      recordElem.title = "";
      recorder = null;
      recordBuffer = [];
      clearTimeout(timeout);
      timeout = 0;
      if (stopSignFunc) {
        addon.tab.traps.vm.runtime.off("PROJECT_STOP_ALL", stopSignFunc);
        stopSignFunc = null;
      }
    };
    const stopRecording = (force) => {
      if (isWaitingForFlag) {
        addon.tab.traps.vm.runtime.off("PROJECT_START", waitingForFlagFunc);
        isWaitingForFlag = false;
        waitingForFlagFunc = null;
        abortController.abort();
        abortController = null;
        disposeRecorder();
        return;
      }
      if (!isRecording || !recorder || recorder.state === "inactive") return;
      if (force) {
        disposeRecorder();
      } else {
        recorder.onstop = () => {
          const blob = new Blob(recordBuffer, { type: mimeType });
          downloadBlob(`${addon.tab.redux.state?.preview?.projectInfo?.title || "video"}.${fileExtension}`, blob);
          disposeRecorder();
        };
        recorder.stop();
      }
    };
    const startRecording = async (opts) => {
      // Timer
      const secs = Math.min(MAX_RECORD_TIME, Math.max(1, opts.secs));

      // Initialize MediaRecorder
      recordBuffer = [];
      isRecording = true;
      const vm = addon.tab.traps.vm;
      let micStream;
      if (opts.micEnabled) {
        // Show permission dialog before green flag is clicked
        try {
          micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        } catch (e) {
          if (e.name !== "NotAllowedError" && e.name !== "NotFoundError") throw e;
          opts.micEnabled = false;
        }
      }

      // After we see if the user has/enables their mic, save settings to localStorage.
      localStorage.setItem(LOCALSTORAGE_ENTRY, JSON.stringify(opts));

      if (opts.waitUntilFlag) {
        isWaitingForFlag = true;
        Object.assign(recordElem, {
          textContent: msg("click-flag"),
          title: msg("click-flag-description"),
        });
        abortController = new AbortController();
        try {
          await Promise.race([
            new Promise((resolve) => {
              waitingForFlagFunc = () => resolve();
              vm.runtime.once("PROJECT_START", waitingForFlagFunc);
            }),
            new Promise((_, reject) => {
              abortController.signal.addEventListener("abort", () => reject("aborted"), { once: true });
            }),
          ]);
        } catch (e) {
          if (e.message === "aborted") return;
          throw e;
        }
      }
      isWaitingForFlag = false;
      waitingForFlagFunc = abortController = null;
      const stream = new MediaStream();
      const videoStream = vm.runtime.renderer.canvas.captureStream();
      stream.addTrack(videoStream.getVideoTracks()[0]);

      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      if (opts.audioEnabled) {
        const mediaStreamDestination = vm.runtime.audioEngine.audioContext.createMediaStreamDestination();
        vm.runtime.audioEngine.inputNode.connect(mediaStreamDestination);
        const audioSource = ctx.createMediaStreamSource(mediaStreamDestination.stream);
        audioSource.connect(dest);
      }
      if (opts.micEnabled) {
        const micSource = ctx.createMediaStreamSource(micStream);
        micSource.connect(dest);
      }
      if (opts.audioEnabled || opts.micEnabled) {
        stream.addTrack(dest.stream.getAudioTracks()[0]);
      }
      recorder = new MediaRecorder(stream, { mimeType });
      recorder.ondataavailable = (e) => {
        recordBuffer.push(e.data);
      };
      recorder.onerror = (e) => {
        console.warn("Recorder error:", e.error);
        stopRecording(true);
      };
      timeout = setTimeout(() => stopRecording(false), secs * 1000);
      if (opts.useStopSign) {
        stopSignFunc = () => stopRecording();
        vm.runtime.once("PROJECT_STOP_ALL", stopSignFunc);
      }

      // Delay
      const delay = opts.delay || 0;
      const roundedDelay = Math.floor(delay);
      for (let index = 0; index < roundedDelay; index++) {
        recordElem.textContent = msg("starting-in", { secs: roundedDelay - index });
        await new Promise((resolve) => setTimeout(resolve, 975));
      }
      setTimeout(
        () => {
          recordElem.textContent = msg("stop");

          recorder.start(1000);
        },
        (delay - roundedDelay) * 1000
      );
    };

    // Insert start/stop recording button
    if (!recordElem) {
      recordElem = Object.assign(document.createElement("div"), {
        className: "sa-record " + referenceElem.className,
        textContent: msg("record"),
        title: msg("added-by"),
      });
      recordElem.addEventListener("click", async () => {
        if (isRecording) {
          stopRecording();
        } else {
          const opts = await getOptions();
          if (!opts) {
            console.log("Canceled");
            return;
          }
          startRecording(opts);
        }
      });
    }
    referenceElem.parentElement.appendChild(recordElem);
  }
};
