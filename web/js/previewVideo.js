import { app } from "../../../scripts/app.js";
import { api } from '../../../scripts/api.js'

function fitHeight(node) {
  node.setSize([node.size[0], node.computeSize([node.size[0], node.size[1]])[1]])
  node?.graph?.setDirtyCanvas(true);
}
function chainCallback(object, property, callback) {
  if (object == undefined) {
    //This should not happen.
    console.error("Tried to add callback to non-existant object")
    return;
  }
  if (property in object) {
    const callback_orig = object[property]
    object[property] = function () {
      const r = callback_orig.apply(this, arguments);
      callback.apply(this, arguments);
      return r
    };
  } else {
    object[property] = callback;
  }
}

function addPreviewOptions(nodeType) {
  chainCallback(nodeType.prototype, "getExtraMenuOptions", function (_, options) {
    // The intended way of appending options is returning a list of extra options,
    // but this isn't used in widgetInputs.js and would require
    // less generalization of chainCallback
    let optNew = []
    try {
      const previewWidget = this.widgets.find((w) => w.name === "videopreview");

      let url = null
      if (previewWidget.videoEl?.hidden == false && previewWidget.videoEl.src) {
        //Use full quality video
        //url = api.apiURL('/view?' + new URLSearchParams(previewWidget.value.params));
        url = previewWidget.videoEl.src
      }
      if (url) {
        optNew.push(
          {
            content: "Open preview",
            callback: () => {
              window.open(url, "_blank")
            },
          },
          {
            content: "Save preview",
            callback: () => {
              const a = document.createElement("a");
              a.href = url;
              a.setAttribute("download", new URLSearchParams(previewWidget.value.params).get("filename"));
              document.body.append(a);
              a.click();
              requestAnimationFrame(() => a.remove());
            },
          }
        );
      }
      if (options.length > 0 && options[0] != null && optNew.length > 0) {
        optNew.push(null);
      }
      options.unshift(...optNew);

    } catch (error) {
      console.log(error);
    }

  });
}
function previewVideo(node, file, type) {
    console.log("========== Preview Video Debug Info ==========");
    console.log("Preview Video params:", { file, type });
    console.log("Node:", node);
    
    var element = document.createElement("div");
    console.log("Created element:", element);
    
    const previewNode = node;
    var previewWidget = node.addDOMWidget("videopreview", "preview", element, {
        serialize: false,
        hideOnZoom: false,
        getValue() {
            return element.value;
        },
        setValue(v) {
            element.value = v;
        },
    });
    console.log("Created preview widget:", previewWidget);

    previewWidget.computeSize = function (width) {
        if (this.aspectRatio && !this.parentEl.hidden) {
            let height = (previewNode.size[0] - 20) / this.aspectRatio + 10;
            if (!(height > 0)) {
                height = 0;
            }
            this.computedHeight = height + 10;
            return [width, height];
        }
        return [width, -4];//no loaded src, widget should not display
    }
    // element.style['pointer-events'] = "none"
    previewWidget.value = { hidden: false, paused: false, params: {} }
    previewWidget.parentEl = document.createElement("div");
    previewWidget.parentEl.className = "video_preview";
    previewWidget.parentEl.style['width'] = "100%"
    element.appendChild(previewWidget.parentEl);
    previewWidget.videoEl = document.createElement("video");
    previewWidget.videoEl.controls = true;
    previewWidget.videoEl.loop = false;
    previewWidget.videoEl.muted = false;
    previewWidget.videoEl.style['width'] = "100%"
    previewWidget.videoEl.addEventListener("loadedmetadata", () => {
        previewWidget.aspectRatio = previewWidget.videoEl.videoWidth / previewWidget.videoEl.videoHeight;
        fitHeight(previewNode);
    });
    previewWidget.videoEl.addEventListener("error", () => {
        //TODO: consider a way to properly notify the user why a preview isn't shown.
        previewWidget.parentEl.hidden = true;
        fitHeight(previewNode);
    });

    let params = {
        "filename": file,
        "type": type,
    }
    console.log("Preview Video URL params:", params);
    console.log("File path check:", {
        exists: file ? "yes" : "no",
        filePath: file,
        type: type
    });

    previewWidget.parentEl.hidden = previewWidget.value.hidden;
    console.log("Parent element hidden state:", previewWidget.parentEl.hidden);
    
    previewWidget.videoEl.autoplay = !previewWidget.value.paused && !previewWidget.value.hidden;
    console.log("Video autoplay state:", previewWidget.videoEl.autoplay);

    let target_width = 256
    if (element.style?.width) {
        //overscale to allow scrolling. Endpoint won't return higher than native
        target_width = element.style.width.slice(0, -2) * 2;
    }
    if (!params.force_size || params.force_size.includes("?") || params.force_size == "Disabled") {
        params.force_size = target_width + "x?"
    } else {
        let size = params.force_size.split("x")
        let ar = parseInt(size[0]) / parseInt(size[1])
        params.force_size = target_width + "x" + (target_width / ar)
    }

    const apiUrl = api.apiURL('/view?' + new URLSearchParams(params));
    console.log("Final video URL:", apiUrl);
    console.log("API URL components:", {
        baseUrl: api.apiURL(''),
        params: new URLSearchParams(params).toString()
    });

    previewWidget.videoEl.src = apiUrl;
    console.log("Set video element source:", previewWidget.videoEl.src);

    previewWidget.videoEl.hidden = false;
    previewWidget.parentEl.appendChild(previewWidget.videoEl);
    
    // 添加视频加载状态监听
    previewWidget.videoEl.addEventListener('loadstart', () => {
        console.log('Video loading started');
    });
    
    previewWidget.videoEl.addEventListener('loadeddata', () => {
        console.log('Video data loaded');
    });
    
    previewWidget.videoEl.addEventListener('error', (e) => {
        console.error('Video loading error:', e);
        console.error('Video error details:', previewWidget.videoEl.error);
    });

    console.log("========== End Preview Video Debug Info ==========");
}

app.registerExtension({
  name: "Comflowy.VideoPreviewer",
  async init() {
    console.log("Comflowy Video Previewer Extension Initialized");
  },
  async setup() {
    console.log("Comflowy Video Previewer Extension Setup");
  },
  async beforeRegisterNodeDef(nodeType, nodeData, app) {
    console.log("Registering node def for:", nodeData?.name);
    if (nodeData?.name === "Comflowy_Preview_Video") {
      console.log("Configuring Preview Video node");
      nodeType.prototype.onExecuted = function (data) {
        console.log("Preview Video onExecuted called with data:", data);
        previewVideo(this, data.video[0], data.video[1]);
      }
      addPreviewOptions(nodeType)
    }
  }
});

// 额外添加一个全局调试日志
console.log("Comflowy Video Previewer JS Loaded");