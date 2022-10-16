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

function hackTextArea(textArea) {
    const { get, set } = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    
    Object.defineProperty(textArea, 'value', {
            get() {
            return get.call(this);
        },
        set(newVal) {
            let result = set.call(this, newVal);
            if (this.alternate_onchange) {
                this.alternate_onchange(this);
            }
            return result;

        }
    });
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
    canvas.height=height|img.height;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(img,0,0);
    canvas.baseImage=img;
}

function containerToCanvas(canvas,clientX,clientY) {
    let canvasSpace= canvas.getBoundingClientRect();
    let scaleX=canvas.width/canvasSpace.width;
    let scaleY=canvas.height/canvasSpace.height;
    let x= (clientX-canvasSpace.x) * scaleX;
    let y= (clientY-canvasSpace.y) * scaleY;

    return {x,y};
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
    for ( let t of textAreas) {
        hackTextArea(t);
        let gradioParent = t.parentElement.parentElement.parentElement;
        //hide wrapper element that has a border
        gradioParent.style = `
            position:absolute;
            visibility:hidden;
            width:0px;
            height:0px;
        `;
    }
    
    let imageLayers = textAreas.map(makeImageLayer);
    let currentLayer = imageLayers[0];

    let brushColor = "black";
    let brushRadius = 0;
    let toolMode = draw;
    let dragButton = -1;
    let strokePath=[];


    let panel=makeWidgetPanel();
    container.appendChild(panel);

    container.style.position="relative";
    await setBaseImage(textAreas[0].value);

    setActiveLayer(0);



    container.addEventListener("mousedown",handleMouseDown);
    container.addEventListener("mouseup",handleMouseUp);
    container.addEventListener("mousemove",handleMouseMove);
    container.addEventListener("contextmenu",e=>{e.preventDefault()})

    
    let dropBoxes = document.createElement("div");
    dropBoxes.className="drop_area";
    let boxes = imageLayers.map(i => `<div class="drop_target" name="${i.name}"> Drop here to set ${i.name} </div>`)
    dropBoxes.innerHTML=boxes.join(" ");

    container.appendChild(dropBoxes);
    container.addEventListener("dragover", handleDragOver)
    container.addEventListener("dragleave", handleDragLeave)
    //container.addEventListener("drop", handleDrop)

    for (let box of dropBoxes.querySelectorAll(".drop_target")) {
        box.addEventListener("dragover", handleTargetDragOver)
        box.addEventListener("dragleave", handleTargetDragLeave)
        box.addEventListener("drop", handleTargetDrop)    
    }
    setBrushRadius(5);    


    function handleDragOver(e) {
        e.currentTarget.classList.add("drag_hover")
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy'
    }
    function handleDragLeave(e) {
        e.currentTarget.classList.remove("drag_hover")
    }

    function handleTargetDragOver(e) {
        e.currentTarget.classList.add("drag_hover")
        e.dataTransfer.dropEffect = 'copy'
    }

    function handleTargetDrop(e) {
        e.preventDefault();
        let layer = e.currentTarget.getAttribute("name")
        console.log("dropped on "+layer,e); 
        let items= e.dataTransfer.items;
        if (items.length == 1) {
            if (items[0].kind==="file") {
                setActiveLayer(layer);
                loadLayerFromFile(layer,items[0].getAsFile());
                
            }
        }
        e.currentTarget.classList.remove("drag_hover")
        container.classList.remove("drag_hover")
    }

    function handleTargetDragLeave(e) {
        e.currentTarget.classList.remove("drag_hover")
    }

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

   async function loadLayerFromFile(layerName,file) {
        let layer = imageLayers.find(a=>a.name==layerName);
        if (!layer) return;
        let url = URL.createObjectURL(file)
        await layer.setFromURL(url)
        URL.revokeObjectURL(url);
        layer.communicateChange();
    }

    

    function setActiveLayer(layerID) {
        let layer = currentLayer;
        if (Number.isInteger(layerID)) {
            layer=imageLayers[layerID];
        } else {
            layer = imageLayers.find(a=>a.name==layerID);
        }
        currentLayer=layer;
        composeImage();
        updatePanel();
    }

    
    function makeImageLayer(textArea) {
        let layerCanvas=document.createElement("canvas");
        let ctx = layerCanvas.getContext("2d");
        layerCanvas.width=1;
        layerCanvas.height=1;
        const name = textArea.previousElementSibling.textContent;
        const isMask = name.toLowerCase()=="mask";
        let redoBuffer=[];
        let history=[];
        
        resetHistory();

        //textArea.addEventListener("scroll",  updateImageFromTextArea )
        // console.log("adding scroll catch to ", textArea)
        textArea.alternate_onchange=updateImageFromTextArea;

        async function updateImageFromTextArea(e) {
            await setFromURL(textArea.value);
        }

        async function setFromURL(url) {
            await setCanvasImageURL(layerCanvas,url);
            if (isMask) convertImageToMask();
            pushHistory();
            composeImage();
        } 

        function convertImageToMask() {
            let current = ctx.getImageData(0,0,layerCanvas.width,layerCanvas.height);
            let pixels = new Uint32Array(current.data.buffer);

            let noAlpha = true;
            for (let i=3;i<current.data.length;i+=4) {
                if(current.data[i] != 0xff ) {
                    noAlpha=false;
                    break;
                }
            } 
            console.log({noAlpha});
            if (noAlpha) {
                for (let i=0; i<current.data.length; i+=4) {
                    let r=current.data[i+0];
                    let g=current.data[i+1];
                    let b=current.data[i+2];
                    let y= Math.round((0.2989 *r)  + (0.5870*g) + (0.1140*b));                     
                    current.data[i+3] = 255-y;
                }
            }            
            pixels.forEach((p,i)=>pixels[i]=p&0xff000000)            
            ctx.putImageData(current,0,0);
        }


        function resetHistory() {
            redoBuffer=[];
            history=[ctx.getImageData(0,0,layerCanvas.width,layerCanvas.height)];
            
        }

        let getHistory = _=>history;
        let getRedoBuffer = _=>redoBuffer;
        

        function undo() {
            if (history.length==0) return;
            redoBuffer.push(history.pop());
            ctx.putImageData(history.at(-1),0,0);
            communicateChange();
        }

        function redo() {
            if (redoBuffer.length==0) return;

            history.push(redoBuffer.pop());
            ctx.putImageData(history.at(-1),0,0);
            communicateChange();
        }

        function communicateChange() {
            textArea.value=layerCanvas.toDataURL();
            let e = new Event('input');
            textArea.dispatchEvent(e);
        }
    
        function pushHistory() {
            const areEqual = (first, second) =>
                first.length === second.length && first.every((value, index) => value === second[index]);
    
    
            let newEntry = ctx.getImageData(0,0,canvas.width,canvas.height);
            let current = history.at(-1);
            if(areEqual(newEntry.data,current.data)) return;
            history.push(newEntry);
            history=history.slice(-UndoHistoryLength)
            redoBuffer=[];
        }
    
    
        return Object.freeze({
            textArea,
            ctx,
            canvas:layerCanvas,
            name, isMask,
            undo,redo,getRedoBuffer,setFromURL,
            getHistory,resetHistory,pushHistory,communicateChange});
   }
    
    function setBrushRadius(radius=5){
        brushRadius=radius;
        let url = makeBrushCursorImage(radius);
        canvas.parentElement.style.cursor=` url(${url}) ${radius} ${radius}, pointer`;
    }
    
    function drawStroke() {
        let ctx=currentLayer.ctx;
        
        ctx.save();
        let clear = (dragButton==2) || (toolMode==erase)
        if (clear) {
            ctx.globalCompositeOperation="destination-out";
            ctx.strokeStyle="black";    
        } else {
            ctx.strokeStyle = currentLayer.isMask?"black":brushColor;
        }

        ctx.beginPath();
        for (let {x,y} of strokePath) {
            ctx.lineTo(x,y);
        }
        if  (strokePath.length == 1) ctx.closePath(); // Make it a dot
        ctx.lineWidth=brushRadius*2;
        ctx.lineCap="round";
        ctx.lineJoin="round";
        ctx.stroke();
        ctx.restore();
    }


    function composeImage() {
        mainctx.save();
        console.log("compose")
        mainctx.clearRect(0,0,canvas.width,canvas.height);
        for (let layer of imageLayers) {
            mainctx.drawImage(layer.canvas,0,0);            
            if (layer == currentLayer) {
                mainctx.globalAlpha=0.2;  //anything above the active layer is faint
            }
        }
        mainctx.restore();
    }

    function endDraw(e) {
        
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
        let {x,y} = containerToCanvas(canvas,e.clientX,e.clientY)
        if (toolMode.mouseDown) {
            return toolMode.mouseDown(e,x,y)
        }
    }

   function handleMouseUp(e){
        let {x,y} = containerToCanvas(canvas,e.clientX,e.clientY)
        if (toolMode.mouseUp) {
            return toolMode.mouseUp(e,x,y)
        }
    }

    function handleMouseMove(e) {
        let {x,y} = containerToCanvas(canvas,e.clientX,e.clientY)
        if (toolMode.mouseMove) {
            return toolMode.mouseMove(e,x,y)
        }
    }

    function updatePanel() {
        undo.button.classList.toggle("disabled",currentLayer.getHistory().length<=1);
        redo.button.classList.toggle("disabled",currentLayer.getRedoBuffer().length==0);

        for (let button of panel.querySelectorAll('.div_button.tool')){
            console.log(button.function, "   ",toolMode)
            button.classList.toggle("selected",button.function==toolMode);
        }
        for (let color of panel.querySelectorAll('.swatch_button ')) {
            color.classList.toggle("selected",brushColor==color.style.backgroundColor);
        }

        if (imageLayers.length > 1) { 
            currentLayer.textArea.input.checked=true;
        }

        panel.classList.toggle("mono",currentLayer.name=="Mask");
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
        toolMode=erase;
        updatePanel();
    }   
    function draw() {
        toolMode=draw;
        updatePanel();
    }
    
    function dropper() {
        toolMode=dropper;
        updatePanel();
    }

    function threshold() {

    }

    function transform() {

    }
    function layerChange(e) {
        setActiveLayer(e.currentTarget.valueIndex)
    }

    draw.mouseDown = function(e,x,y) {
        if (dragButton >= 0) return;  //ignore extra downs while drawing
        dragButton= e.button;    
        strokePath=[{x,y}];

    }
    draw.mouseUp = function(e,x,y) {
        if (e.button == dragButton) {
            endDraw();
        }
    }
    draw.mouseMove = function(e,x,y) {
        if (dragButton < 0)  return;
        if (e.buttons==0) {
            //we lost a mouseup somewhere 
            endDraw(); 
            return;
        }
        strokePath.push(containerToCanvas(canvas,e.clientX,e.clientY));
        currentLayer.ctx.putImageData(currentLayer.getHistory().at(-1),0,0);
        drawStroke(currentLayer.ctx);

        composeImage();
    }
    erase.mouseDown=draw.mouseDown;
    erase.mouseUp=draw.mouseUp;
    erase.mouseMove=draw.mouseMove;

    function brushRadiusControl() {
        let element = document.createElement("canvas");
        element.className="brush_size"
        let ctx = element.getContext("2d");
        element.width=64;
        element.height=192;
        let radius = 15
        function redraw() {
            ctx.clearRect(0,0,element.width,element.height);
            ctx.beginPath();
            ctx.arc(32,160,32,0,Math.PI);
            ctx.lineTo(32,0);
            ctx.fillStyle="#8888";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(32,radius*5,radius,0,Math.PI*2);
            ctx.fillStyle="#000";
            ctx.fill();    
        }

        Object.defineProperty(element, 'radius', {
            get() { return radius; },
            set(value) {
                if (value<1) value=1;
                if (value>32) value=32;
                if (value !== radius) {
                    radius=value;
                    element.dispatchEvent(new Event("changed"));
                }
                redraw();
            }
          });

        let dragging = false;
        function handleMouseDown(e) {
            if (e.button !==0 ) return
            let {x,y} = containerToCanvas(element,e.clientX,e.clientY)
            e.stopPropagation();
            element.radius=y/5;
            dragging=(x>0)  && (x<element.width);
        }
        function handleMouseMove(e) {
            if (!dragging) return;
            if (e.buttons === 0 )
            {
                dragging=false;
                return
            }    
            
            let {x,y} = containerToCanvas(element,e.clientX,e.clientY)
            
            element.radius=y/5;
            
        }
        function handleMouseUp(e) {
            if (e.button !==0 ) return
            dragging=false;
        }
        
        element.addEventListener("mousedown", handleMouseDown,{capture:true});
        element.addEventListener("mousemove", handleMouseMove);
        element.addEventListener("mouseup", handleMouseUp);
        
        
        redraw();
        return element
    }

    function swatchButtonPress(e) {
        e.stopPropagation();
        brushColor=e.currentTarget.style.backgroundColor;
        updatePanel();
    }

    function makeWidgetPanel() {
        let panel = document.createElement("div");
        panel.className="widget_panel";

        let brushRadiusWidget = brushRadiusControl();
        panel.appendChild(brushRadiusWidget);
        brushRadiusWidget.addEventListener("changed",
            _=>{setBrushRadius(brushRadiusWidget.radius);});
        brushRadiusWidget.radius=7;        

        function makeDivButton(addClass="",parent=panel) {
            let result = document.createElement("div");
            result.className="div_button "+addClass;
            parent.appendChild(result);
            return result
        }

        let swatchPanel = document.createElement("div");
        swatchPanel.className = "swatch" 
        panel.appendChild(swatchPanel);
        let colors =["black","green","red","Orange","Yellow","blue","brown","white"];
        for (let c of colors) {
            let button = makeDivButton("swatch_button",swatchPanel);
            button.style.backgroundColor=c;
            button.addEventListener("mousedown",  swatchButtonPress);
        }
        
        if (imageLayers.length > 1) {
            let layerNames = imageLayers.map(({name})=>name);
            let radioItems = createRadioItems(layerNames,layerChange);
            for (let {input,label}  of radioItems) {
                panel.appendChild(input);
                panel.appendChild(label);
                console.log("layer index",input.valueIndex)
                imageLayers[input.valueIndex].textArea.input = input;
            }
        }

        let actions = [undo,redo,clear,transform,dropper,threshold,draw,erase];
        for (let f of actions) {
            let button = makeDivButton(f.name);
            button.classList.add("tool");
            button.function=f;
            button.title=f.name;
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