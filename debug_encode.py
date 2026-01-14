from PIL import Image
import os
import io
import base64

def encode_pil_image(img):
    buffered = io.BytesIO()
    img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

img_path = "Patient_sName__JAKUNAS_JUSTINAS_StudyDate__20240508_a478ced0/img/import_1768298436/00000005/0059.jpg"
if os.path.exists(img_path):
    with Image.open(img_path) as img:
        b64 = encode_pil_image(img)
        print(f"B64 Length: {len(b64)}")
        print(f"B64 Start: {b64[:50]}")
        print(f"B64 End: {b64[-50:]}")
else:
    print("Image not found")
