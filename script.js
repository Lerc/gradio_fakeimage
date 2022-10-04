"use strict"
console.log("supplimentary script is running");

function gradioApp(){
    return document.getElementsByTagName('gradio-app')[0].shadowRoot;
}

addEventListener("load", _=>setTimeout(patchGradioComponents,100));


function patchGradioComponents() {
    saySomething();

    let gApp=gradioApp();
    let fake_canvases=gApp.querySelectorAll(".fakeimage_textbox");
    console.log("fake canvases", fake_canvases);
    for (let c of fake_canvases) {
        patchCanvas(c);
    }
}

function setCanvasImageURL(canvas,URL,width,height) {
    var ctx = canvas.getContext('2d');
    var img = new Image;
    img.onload = function(){
        canvas.width=width||img.width;
        canvas.height=height|img.height
        ctx.drawImage(img,0,0);
        canvas.baseImage=img;
    };
    img.src=URL;
}

function patchCanvas(canvas) {
    let container = canvas.parentElement;
    let textArea = container.previousElementSibling.querySelector("textarea");

    let brushRadius = 0;
    let dragButton = -1;
    let canvasChanged = false;

    setCanvasImageURL(canvas,textArea.value);

    let ctx = canvas.getContext("2d");
    container.addEventListener("mousedown",handleMouseDown);
    container.addEventListener("mouseup",handleMouseUp);
    container.addEventListener("mousemove",handleMouseMove);
    container.addEventListener("contextmenu",e=>{e.preventDefault()})

    setBrushRadius(5);    
    //textArea.value=canvas.toDataURL();
   // textArea.dispatchEvent(new InputEvent("input"));

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

    function endDraw() {
        dragButton=-1;
        if (canvasChanged) {
            textArea.value=canvas.toDataURL();
            textArea.dispatchEvent(new Event('input'));
        }
    }
    

    
    function handleMouseDown(e){
        if (dragButton >= 0) return;  //ignore extra downs while drawing
        dragButton= e.button;    
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
        let {x,y}= containerToCanvas(e.clientX,e.clientY);
        canvasChanged=true;
        ctx.fillStyle = ["black","red","white","orange"][dragButton];
        ctx.beginPath();
        ctx.arc(x,y,brushRadius,0,Math.PI*2)
        ctx.fill();
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