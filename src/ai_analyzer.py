import os
import base64
import json
import requests
import math
import subprocess
import re
from typing import List, Dict, Any
from PIL import Image, ImageDraw

LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"

def encode_pil_image(img: Image.Image) -> str:
    import io
    buffered = io.BytesIO()
    img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

def encode_image(image_path: str) -> str:
    """Encode an image as a base64 string directly from disk."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")

def create_grid_image(image_paths: List[str], cols: int = 4) -> Image.Image:
    if not image_paths:
        return None
    
    images = []
    for p in image_paths:
        try:
            images.append(Image.open(p))
        except Exception as e:
            print(f"Error opening image {p}: {e}")
            
    if not images:
        return None
        
    w, h = images[0].size
    rows = math.ceil(len(images) / cols)
    grid_img = Image.new('RGB', (cols * w, rows * h), color=(0, 0, 0))
    
    for idx, img in enumerate(images):
        x = (idx % cols) * w
        y = (idx // cols) * h
        grid_img.paste(img, (x, y))
        
        draw = ImageDraw.Draw(grid_img)
        label = os.path.basename(image_paths[idx])
        draw.text((x + 5, y + 5), label, fill=(255, 255, 0))
        
    return grid_img

def launch_lmstudio():
    """Attempt to launch LM Studio and start the local server."""
    import time
    
    # First, check if server is already running
    try:
        test_response = requests.get("http://localhost:1234/v1/models", timeout=2)
        if test_response.status_code == 200:
            print("[AI] LM Studio server is already running.")
            return True
    except:
        pass  # Server not running, proceed to start it
    
    # Try to start the server using lms CLI
    try:
        print("[AI] Starting LM Studio server via CLI...")
        subprocess.run(["lms", "server", "start"], check=False, capture_output=True)
        
        # Wait for server to become available (up to 15 seconds)
        for i in range(15):
            try:
                test_response = requests.get("http://localhost:1234/v1/models", timeout=2)
                if test_response.status_code == 200:
                    print(f"[AI] Server started successfully after {i+1}s.")
                    return True
            except:
                pass
            time.sleep(1)
        
        print("[AI] Server did not start in time. Please start it manually in LM Studio.")
        return False
    except FileNotFoundError:
        # lms CLI not found, fall back to opening the app
        print("[AI] lms CLI not found, opening LM Studio app...")
        subprocess.run(["open", "-a", "LM Studio"], check=False)
        return False
    except Exception as e:
        print(f"[AI] Failed to start LM Studio server: {e}")
        return False
PREFERRED_VISION_MODELS = [
    "mistralai/ministral-3-14b-reasoning",
    "llava-1.6-mistral-7b",
    "llava-v1.5-7b",
    "vision" # Any model with 'vision' in its ID
]

def get_active_model():
    """Fetch the best available vision model from LM Studio."""
    try:
        response = requests.get(f"{LMSTUDIO_URL.replace('/chat/completions', '')}/models", timeout=5)
        if response.status_code == 200:
            models = response.json().get('data', [])
            model_ids = [m['id'] for m in models]
            
            # Try to find a preferred model
            for pref in PREFERRED_VISION_MODELS:
                for mid in model_ids:
                    if pref in mid.lower():
                        print(f"[AI] Using model: {mid}")
                        return mid
            
            if model_ids:
                print(f"[AI] Falling back to first available model: {model_ids[0]}")
                return model_ids[0]
    except Exception as e:
        print(f"[AI] Error detecting models: {e}")
        
    return "llava-1.6-mistral-7b" # Default fallback

DIAGNOSTIC_PROTOCOLS = [
    {
        "role": "ENT Radiologist",
        "focus": "Sinus & Airway",
        "prompt": """Evaluate sinuses (Maxillary, Ethmoid, Sphenoid, Frontal) and nasal cavities.
Look for: Mucosal thickening, fluid levels, polyps, septal deviation, or airway obstruction.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Identified Areas**: List visible anatomical structures.
2. **Analysis & Recommendations**: Brief analysis of each area. If pathology is found, suggest next steps."""
    },
    {
        "role": "Musculoskeletal Radiologist",
        "focus": "Bones & Structure",
        "prompt": """Evaluate facial skeleton and skull base.
Look for: Cortical integrity, marrow signal changes, fractures, erosions, or lesions.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Identified Areas**: List visible anatomical structures.
2. **Analysis & Recommendations**: Brief analysis of each area. If pathology is found, suggest next steps."""
    },
    {
        "role": "Neuroradiologist",
        "focus": "Soft Tissue & Vascular",
        "prompt": """Evaluate soft tissues, brain parenchyma, orbits, and vascular flow voids.
Look for: Abnormal signals, masses, inflammation, orbital issues, or brain morphology.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Identified Areas**: List visible anatomical structures.
2. **Analysis & Recommendations**: Brief analysis of each area. If pathology is found, suggest next steps."""
    }
]

def clean_ai_response(text: str) -> str:
    """Strip internal thought blocks from reasoning models."""
    # Remove [THINK]...[/THINK] or [THINK]... tags
    # Only remove if the closing tag is present to avoid wiping content on truncation
    cleaned = re.sub(r'\[THINK\].*?\[/THINK\]', '', text, flags=re.DOTALL | re.IGNORECASE)
    cleaned = re.sub(r'<think>.*?</think>', '', cleaned, flags=re.DOTALL | re.IGNORECASE)
    return cleaned.strip()

def analyze_slice_with_protocol(img_path: str, protocol: Dict[str, str], context_prompt: str):
    """Generator that yields tokens from the AI, filtering out internal thinking."""
    b64_data = encode_image(img_path)
    
    combined_instruction = f"""{protocol['prompt']}

{context_prompt}
Output your analysis for this specific domain only."""

    payload = {
        "model": get_active_model(),
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{b64_data}"
                        }
                    },
                    {"type": "text", "text": combined_instruction}
                ]
            }
        ],
        "temperature": 0.1,
        # "max_tokens": -1, # Let LM Studio control this
        "top_p": 0.9,
        "stream": False
    }

    try:
        response = requests.post(LMSTUDIO_URL, json=payload, timeout=300)
        response.raise_for_status()
        
        result_json = response.json()
        content = result_json['choices'][0]['message']['content']
        
        # Clean up thought blocks before yielding
        clean_content = clean_ai_response(content)
        yield clean_content

    except Exception as e:
        yield f"Error executing {protocol['focus']} protocol: {str(e)}"
                    
    except Exception as e:
        yield f"Error executing {protocol['focus']} protocol: {str(e)}"

def analyze_series_ai(series_path: str, sample: int = 1, prompt: str = ""):
    """Analyze a series by individual slices using the multi-pass ensemble method."""
    launch_lmstudio()
    
    all_images = sorted([f for f in os.listdir(series_path) if f.lower().endswith((".jpg", ".jpeg", ".png"))])
    images_to_process = all_images[::sample]
    
    if not images_to_process:
        return {"error": "No images found to process."}

    num_images = len(images_to_process)
    full_analysis = []
    
    print(f"Processing {num_images} images with multi-pass specialist ensemble...")

    for idx, img_name in enumerate(images_to_process):
        # Non-streaming fallback for bulk analyze
        img_path = os.path.join(series_path, img_name)
        slice_report = [f"### Slice: {img_name}"]
        context_prompt = f"{prompt}\n(Study Context: Image {idx+1} of {num_images}, Filename: {img_name})"
        
        for proto in DIAGNOSTIC_PROTOCOLS:
            res_content = ""
            for delta in analyze_slice_with_protocol(img_path, proto, context_prompt):
                res_content += delta
            slice_report.append(f"#### {proto['focus']} Analysis\n{res_content}")
            
        full_analysis.append("\n\n".join(slice_report))

    combined_report = "\n\n---\n\n".join(full_analysis)
    
    header = f"## Multi-Speciality Ensemble Analysis ({num_images} slices)\n"
    header += "> [!NOTE]\n"
    header += "> Comparison of findings from ENT, Musculoskeletal, and Neuroradiology specialist agents.\n\n"
    
    return {
        "analysis": header + combined_report,
        "image_count": num_images
    }


def analyze_series_ai_streaming(series_path: str, sample: int = 1, prompt: str = "", mode: str = "series", slice_index: int = 0, specialists: List[str] = None):
    """Generator that yields multi-pass analysis for each slice."""
    launch_lmstudio()
    
    # Filter protocols based on user selection
    active_protocols = DIAGNOSTIC_PROTOCOLS
    if specialists:
        active_protocols = [p for p in DIAGNOSTIC_PROTOCOLS if p['role'] in specialists]

    if not active_protocols:
        yield {"type": "error", "message": "No valid specialists selected."}
        return
        
    all_images = sorted([f for f in os.listdir(series_path) if f.lower().endswith((".jpg", ".jpeg", ".png"))])
    
    if mode == "current" and 0 <= slice_index < len(all_images):
        images_to_process = [all_images[slice_index]]
    else:
        images_to_process = all_images[::sample]
    
    if not images_to_process:
        yield {"type": "error", "message": "No images found to process."}
        return

    num_images = len(images_to_process)
    yield {"type": "status", "message": f"Starting specialist ensemble analysis of {num_images} slice(s)...", "total": num_images}

    for idx, img_name in enumerate(images_to_process):
        img_path = os.path.join(series_path, img_name)
        
        try:
            with Image.open(img_path) as img:
                thumb = img.copy()
                thumb.thumbnail((128, 128), Image.Resampling.LANCZOS)
                thumb_b64 = encode_pil_image(thumb)
                b64_data = encode_pil_image(img)
        except Exception as e:
            yield {
                "type": "error",
                "message": f"Error loading image {img_name}: {str(e)}"
            }
            continue
        
        # Signal start of new slice
        yield {
            "type": "slice_start",
            "index": idx + 1,
            "total": num_images,
            "filename": img_name,
            "thumbnail": thumb_b64,
            "series_index": all_images.index(img_name)
        }
        
        context_prompt = f"{prompt}\n(Image {idx+1} of {num_images}, Filename: {img_name})"
        slice_sections = []
        
        # Run protocols sequentially regarding slice
        for proto in active_protocols:
            # Yield transparent status update
            yield {
                "type": "progress", 
                "current": idx + 1, 
                "total": num_images, 
                "filename": img_name, 
                "status": f"Running {proto['focus']} analysis..."
            }
            
            full_res = ""
            for chunk in analyze_slice_with_protocol(img_path, proto, context_prompt):
                full_res += chunk
            
            slice_sections.append(f"#### {proto['focus']} Findings\n{full_res}")
            
            # Final result for this specialist
            yield {
                "type": "specialist_result",
                "index": idx + 1,
                "filename": img_name,
                "role": proto['role'],
                "focus": proto['focus'],
                "analysis": full_res
            }
        
        full_slice_report = "\n\n".join(slice_sections)
            
        yield {
            "type": "slice_complete",
            "index": idx + 1,
            "total": num_images,
            "filename": img_name,
            "thumbnail": thumb_b64,
            "analysis": full_slice_report,
            "series_index": all_images.index(img_name)
        }

    yield {"type": "complete", "total": num_images}
