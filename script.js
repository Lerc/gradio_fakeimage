"use strict"
console.log("supplimentary script is running");

function gradioApp(){
    return document.getElementsByTagName('gradio-app')[0].shadowRoot;
}

addEventListener("load", _=>setTimeout(patchGradioComponents,100));

const UndoHistoryLength=10;

async function patchGradioComponents() {
    saySomething();

    let gApp=gradioApp();
    let fake_canvases=gApp.querySelectorAll(".pseudoimage");
    console.log("fake canvases", fake_canvases);
    for (let c of fake_canvases) {
        patchCanvas(c);
    }
}

function loadImage(URL) {
    return new Promise( (resolve,reject) => { 
        var img = new Image;
        img.onload = _=> {resolve(img)}
        img.onerror = e => {reject(e)}
        img.src=URL;
    });
}

async function setCanvasImageURL(canvas,URL,width,height) {
    let img = await loadImage(URL);
    var ctx = canvas.getContext('2d');
    canvas.width=width||img.width;
    canvas.height=height|img.height
    ctx.drawImage(img,0,0);
    canvas.baseImage=img;
}

function uid(){
    return Date.now().toString(36) + Math.random().toString(36).substring(0,4);
}

function createRadioItems(items,inputEvent,groupName=uid()) {
    let result = [];
    let valueIndex=0;    
    for (let i of items) {
        let input = document.createElement("input");
        let label = document.createElement("label");
        if (inputEvent) input.addEventListener("input",inputEvent);
        let id=uid();
        input.type ="radio";
        input.id=id;
        input.value=i;
        input.valueIndex = valueIndex++;
        input.name=groupName;
        label.setAttribute("for",id);
        label.innerText=i;

        result.push({input,label});
    }
    return result;
}

async function patchCanvas(canvas) {
    let container = canvas.parentElement;
    container.classList.add("pseudo_image")
    container.style.position="relative";
    let mainctx = canvas.getContext("2d");

    let textAreas = [...container.parentElement.querySelectorAll("textarea")];
    let imageLayers = textAreas.map(makeImageLayer);
    let currentLayer = imageLayers[0];


    let panel=makeWidgetPanel();
    container.appendChild(panel);

    container.style.position="relative";
    await setBaseImage(textAreas[0].value);

    setActiveLayer(0);

    let brushRadius = 0;
    let dragButton = -1;
    let strokePath=[];


    container.addEventListener("mousedown",handleMouseDown);
    container.addEventListener("mouseup",handleMouseUp);
    container.addEventListener("mousemove",handleMouseMove);
    container.addEventListener("contextmenu",e=>{e.preventDefault()})


    setBrushRadius(5);    


    async function setBaseImage(url,targetLayer=imageLayers[0], takeSize=true) {
        let newImage=document.createElement("canvas");
        await setCanvasImageURL(newImage,url);
        let newImageData=newImage.getContext("2d").getImageData(0,0,newImage.width,newImage.height);
        let oldWidth = canvas.width;
        let oldHeight = canvas.height;

        if (takeSize) {
            canvas.width=newImage.width;
            canvas.height=newImage.height;
        }  
        let sizeChanged = (canvas.width !== oldWidth) || (canvas.height !== oldHeight)
        
        console.log("image layers",imageLayers);
        for (let layer of imageLayers) {
            layer.canvas.width=newImage.width;
            layer.canvas.height=newImage.height;
            
            if (sizeChanged) {
                if (layer == targetLayer) {
                    layer.ctx.putImageData(newImageData,0,0);
                } else {
                    layer.ctx.clearRect(0,0,newImage.width,newImage.height);
                }
                layer.resetHistory();
            }
        }
        composeImage();
    }

    window.dogdySetActiveLayer=setActiveLayer;

    function setActiveLayer(index) {
        currentLayer=imageLayers[index];
        composeImage();
        updatePanel();
    }

    function makeImageLayer(textArea) {
        let layerCanvas=document.createElement("canvas");
        let ctx = layerCanvas.getContext("2d");
        layerCanvas.width=1;
        layerCanvas.height=1;

        let redoBuffer=[];
        let history=[];
        let imageChanged=false;
        resetHistory();

        function resetHistory() {
            redoBuffer=[];
            history=[ctx.getImageData(0,0,layerCanvas.width,layerCanvas.height)];
            
        }

        let getHistory = _=>history;
        let getRedoBuffer = _=>redoBuffer;
        let touch = _=>imageChanged=true;

        function undo() {
            if (history.length==0) return;
            redoBuffer.push(history.pop());
            ctx.putImageData(history.at(-1),0,0);
        }

        function redo() {
            if (redoBuffer.length==0) return;

            history.push(redoBuffer.pop());
            ctx.putImageData(history.at(-1),0,0);
        }

        function communicateChange() {
            if (imageChanged) {
                textArea.value=layerCanvas.toDataURL();
                textArea.dispatchEvent(new Event('input'));
            }
            imageChanged=false;
        }
    
        function pushHistory() {
            const areEqual = (first, second) =>
                first.length === second.length && first.every((value, index) => value === second[index]);
    
    
            let newEntry = ctx.getImageData(0,0,canvas.width,canvas.height);
            let current = history.at(-1);
            if(areEqual(newEntry.data,current.data)) return;
            imageChanged=true;
            history.push(newEntry);
            history=history.slice(-UndoHistoryLength)
            redoBuffer=[];
        }
    
    
        return Object.freeze({textArea,ctx,canvas:layerCanvas,undo,redo,getHistory,resetHistory,pushHistory,getRedoBuffer,communicateChange,touch});
   }

   function containerToCanvas(clientX,clientY) {
        let canvasSpace= canvas.getBoundingClientRect();
        let scaleX=canvas.width/canvasSpace.width;
        let scaleY=canvas.height/canvasSpace.height;
        let x= (clientX-canvasSpace.x) * scaleX;
        let y= (clientY-canvasSpace.y) * scaleY;

        return {x,y};
    }  

    
    function setBrushRadius(radius=5){
        brushRadius=radius;
        let url = makeBrushCursorImage(radius);
        canvas.parentElement.style.cursor=` url(${url}) ${radius} ${radius}, pointer`;
    }
    
    function drawStroke() {
        let ctx=currentLayer.ctx;
        
        ctx.save();
        ctx.fillStyle = ["black","red","white","orange"][dragButton];
        ctx.beginPath();
        for (let {x,y} of strokePath) {
            ctx.lineTo(x,y);
        }
        ctx.lineWidth=brushRadius*2;
        ctx.lineCap="round"
        ctx.stroke();
        ctx.restore();
    }


    function composeImage() {
        mainctx.save();
        mainctx.clearRect(0,0,canvas.width,canvas.height);
        for (let layer of imageLayers) {
            mainctx.drawImage(layer.canvas,0,0);            
            if (layer == currentLayer) {
                mainctx.globalAlpha=0.2;  //anything above the active layer is faint
            }
        }
        mainctx.restore();
    }

    function endDraw() {
        
        let {ctx}=currentLayer;
        ctx.putImageData(currentLayer.getHistory().at(-1),0,0);
        drawStroke(ctx);

        currentLayer.pushHistory();

        composeImage();

        currentLayer.communicateChange();
        
        dragButton=-1;
        updatePanel();
    }
    

    function handleMouseDown(e){
        if (dragButton >= 0) return;  //ignore extra downs while drawing
        dragButton= e.button;    
        strokePath=[containerToCanvas(e.clientX,e.clientY)];
    }

   function handleMouseUp(e){
        if (e.button == dragButton) {
            endDraw();
        }
    }

    function handleMouseMove(e) {

        if (dragButton < 0)  return;
        if (e.buttons==0) {
            //we lost a mouseup somewhere 
            endDraw(); 
            return;
        }
        strokePath.push(containerToCanvas(e.clientX,e.clientY));
    

        
        currentLayer.ctx.putImageData(currentLayer.getHistory().at(-1),0,0);
        drawStroke(currentLayer.ctx);

        composeImage();
    }

    function updatePanel() {
        undo.button.classList.toggle("disabled",currentLayer.getHistory().length<=1);
        redo.button.classList.toggle("disabled",currentLayer.getRedoBuffer().length==0);

        if (imageLayers.length > 1) { 
            currentLayer.textArea.input.checked=true;
        }
    }

    function undo() {
        currentLayer.undo();
        composeImage();
        updatePanel();
    }

    function redo() {
        currentLayer.redo();    
        composeImage();
        updatePanel();
    }

    function clear() {        
        currentLayer.ctx.clearRect(0,0,canvas.width,canvas.height);
        currentLayer.pushHistory();
        composeImage();
        currentLayer.communicateChange();

    }
    function erase() {
     
    }
    function draw() {

    }

    function layerChange(e) {
        
        setActiveLayer(e.currentTarget.valueIndex)
    }

    function makeWidgetPanel() {
        let panel = document.createElement("div");
        panel.className="widget_panel";

        function makeDivButton(addClass="") {
            let result = document.createElement("div");
            result.className="div_button "+addClass;
            panel.appendChild(result);
            return result
        }
          
        if (imageLayers.length > 1) {
            let layerNames = imageLayers.map(({textArea})=>textArea.previousElementSibling.innerText);
            let radioItems = createRadioItems(layerNames,layerChange);
            
            for (let {input,label}  of radioItems) {
                panel.appendChild(input);
                panel.appendChild(label);
                console.log("layer index",input.valueIndex)
                imageLayers[input.valueIndex].textArea.input = input;
            }
        }

        let actions = [undo,redo,clear,erase,draw];
        for (let f of actions) {
            let button = makeDivButton(f.name);
            button.addEventListener("mousedown",  
                e=>{
                    e.stopPropagation();
                    if (! f.button.classList.contains("disabled") ) f()
                });
            f.button=button;
        }

        console.log(currentLayer);
        undo.button.classList.toggle("disabled",currentLayer.getHistory().length<=1);
        redo.button.classList.toggle("disabled",currentLayer.getRedoBuffer().length==0);

        return panel;
    }
}

function saySomething(something="something") {
    console.log(something);
}

function makeCanvas(width=256,height=width) {
    let result = document.createElement("canvas");
    result.width=width;
    result.height=height;
    return result;
}

function makeBrushCursorImage(radius=5) {
    let canvas = makeCanvas(radius*2);
    let ctx=canvas.getContext("2d");
    ctx.beginPath();
    ctx.arc(radius,radius,radius,0,Math.PI*2);
    ctx.fillStyle="black";
    ctx.fill();
    ctx.fillStyle="white";
    ctx.fillRect(radius-1,radius-1,2,2);

    return canvas.toDataURL();
}