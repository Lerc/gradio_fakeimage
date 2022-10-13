import os
from re import L
from PIL import Image
from base64 import b64decode, b64encode
from io import BytesIO

import gradio as gr

with open("script.js", "r", encoding="utf8") as jsfile:
    javascript = f'<script>{jsfile.read()}</script>'

with open("style.css", "r", encoding="utf8") as cssfile:
    css = cssfile.read()

if 'gradio_routes_templates_response' not in globals():
    def template_response(*args, **kwargs):
        res = gradio_routes_templates_response(*args, **kwargs)
        res.body = res.body.replace(b'</head>', f'{javascript}</head>'.encode("utf8"))
        res.init_headers()
        return res

    gradio_routes_templates_response = gr.routes.templates.TemplateResponse
    gr.routes.templates.TemplateResponse = template_response

literal_png_dataURL="data:image/png;base64,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"

def pseudo_image():
    
    image_data = gr.Textbox(literal_png_dataURL, interactive=True,visible=True,label="Image",elem_id="textarea_voodoo" )
    test_html = gr.HTML('<canvas class="pseudoimage"></canvas>')
    return image_data

def pseudo_image_and_mask():
    image_data = gr.Textbox(literal_png_dataURL, interactive=True,visible=True,label="Image", elem_id="textarea_voodoo")
    mask_data = gr.Textbox(literal_png_dataURL, interactive=True,visible=True,label="Mask", elem_id="textarea_voodoo")
    test_html = gr.HTML('<canvas class="pseudoimage mask" ></canvas>')
    return image_data,mask_data

def image_from_dataURL(data_url):
    data_url += '=='
    base64_only = data_url.split(',')[1]
    image = Image.open(BytesIO(b64decode(base64_only)))
    return image

def image_to_base64_string(img):
    buffered = BytesIO()
    img.save(buffered, format="PNG")
    return b64encode(buffered.getvalue()).decode("utf-8")

def image_to_dataURL(img):
    return 'data:image/png;base64,' + image_to_base64_string(img)

def test_event(data):
    image = image_from_dataURL(data)
    return image

def convert_back(image):
    print(image)
    url = image_to_dataURL(image)
    return url

def reportArgs(data, **kwargs):
    for key, value in kwargs.items():
        print("%s == %s" % (key, value))

with gr.Blocks(css=css) as demo:
  with gr.Row():
    with gr.Column():
        image_data=pseudo_image()
        image_output = gr.Image(label="Image sent to python", type='pil', image_mode="RGBA")
        image_data.change(fn=test_event,  inputs=image_data, outputs=image_output)
    with gr.Column():
        inpaint_image_data, inpaint_mask_data=pseudo_image_and_mask()
        with gr.Row():    
            inpaint_image_output = gr.Image(label="Image sent to python", type = "pil", image_mode="RGBA")
            inpaint_mask_output = gr.Image(label="Mask sent to python", type ="pil", image_mode="RGBA")
        inpaint_image_data.change(fn=test_event, inputs=inpaint_image_data, outputs=inpaint_image_output)
        inpaint_mask_data.change(fn=test_event, inputs=inpaint_mask_data, outputs=inpaint_mask_output)
        
    #inpaint_image_output.change(fn=convert_back, inputs=inpaint_image_output, outputs=image_data)

demo.launch()