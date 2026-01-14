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
    
    print("[AI] Checking LM Studio server status...")
    
    # Check if server is running
    server_running = False
    try:
        test_response = requests.get("http://localhost:1234/v1/models", timeout=2)
        if test_response.status_code == 200:
            print("[AI] LM Studio server is already running.")
            server_running = True
    except:
        pass
    
    if not server_running:
        # Try to start the server using lms CLI
        try:
            print("[AI] Starting LM Studio server via CLI...")
            result = subprocess.run(["lms", "server", "start"], capture_output=True, text=True)
            if result.returncode != 0:
                print(f"[AI] Error starting server: {result.stderr}")
            
            # Wait for server
            for i in range(15):
                try:
                    requests.get("http://localhost:1234/v1/models", timeout=2)
                    print(f"[AI] Server started successfully after {i+1}s.")
                    server_running = True
                    break
                except:
                    time.sleep(1)
            
            if not server_running:
                print("[AI] Server did not start in time. Trying to open app...")
                subprocess.run(["open", "-a", "LM Studio"], check=False)
                # Give it more time if opening the app
                time.sleep(10)
        except FileNotFoundError:
            print("[AI] 'lms' CLI not found. Please ensure LM Studio is installed and the CLI is bootstrapped.")
            subprocess.run(["open", "-a", "LM Studio"], check=False)
            pass
        except Exception as e:
            print(f"[AI] Failed to launch LM Studio: {e}")
            return False

    # Now ensure a VISION model is loaded
    try:
        print("[AI] Verifying loaded model...")
        # Check currently loaded models via API
        response = requests.get("http://localhost:1234/v1/models", timeout=5)
        current_models = []
        if response.status_code == 200:
            data = response.json()
            current_models = [m['id'] for m in data.get('data', [])]
        
        print(f"[AI] Currently loaded models: {current_models}")
        
        # Valid vision keywords
        vision_keywords = ['vision', 'llava', 'moondream', 'minicpm', 'yi-vl', 'ministral', 'reasoning']
        
        has_vision = any(any(v in m.lower() for v in vision_keywords) for m in current_models)
        
        if not has_vision:
            print("[AI] No vision model currently loaded. Scanning local library...")
            
            # List available models via CLI
            ls_res = subprocess.run(["lms", "ls"], capture_output=True, text=True)
            if ls_res.returncode != 0:
                print("[AI] Failed to list models with 'lms ls'.")
                return True # Can't do much else, hope the user loads one manually
                
            downloaded_output = ls_res.stdout
            found_vision_model = None
            
            # Parse 'lms ls' output. Format is typically:
            # LLM    PARAMS   ...
            # model_id  ...
            # Skip header lines
            lines = downloaded_output.split('\n')
            for line in lines:
                if "PARAMS" in line or "SIZE" in line or not line.strip():
                    continue
                
                # The first token is usually the model ID/name
                parts = line.split()
                if not parts:
                    continue
                    
                model_id = parts[0]
                
                # Check against keywords
                if any(k in model_id.lower() for k in vision_keywords):
                    found_vision_model = model_id
                    break
            
            if found_vision_model:
                print(f"[AI] Found local vision model: {found_vision_model}. Loading...")
                # Use --gpu max to ensure better performance if possible
                load_res = subprocess.run(["lms", "load", found_vision_model, "--gpu", "max"], capture_output=True, text=True)
                
                if load_res.returncode == 0:
                    print(f"[AI] Successfully loaded {found_vision_model}")
                    # Give it a moment to initialize
                    time.sleep(2)
                else:
                    print(f"[AI] Failed to load model: {load_res.stderr}")
            else:
                print("[AI] CRITICAL: No vision model found in LM Studio library.")
                print("[AI] Please download a supported vision model (e.g., Llama 3.2 Vision, LLaVA, Moondream) in LM Studio.")
                # We do not return False here, as we want to let the script try anyway in case our detection was wrong
                # or maybe the text model can hallucinate something (worse case) but better to warn.
                
    except Exception as e:
        print(f"[AI] Error managing models: {e}")
        
    return True

def list_available_models() -> List[Dict[str, Any]]:
    """List all downloaded models available in LM Studio via CLI."""
    try:
        # Check if lms is available
        result = subprocess.run(["lms", "ls"], capture_output=True, text=True)
        if result.returncode != 0:
            return []
            
        models = []
        lines = result.stdout.split('\n')
        
        # Skip header and find data
        # Header usually contains "LLM", "PARAMS", "ARCH", "SIZE"
        # We'll just look for lines that look like model entries
        for line in lines:
            if not line.strip() or "LLM" in line and "PARAMS" in line:
                continue
                
            parts = line.split()
            if len(parts) >= 2:
                model_id = parts[0]
                # Filter out obvious non-model lines if any remain
                if model_id == "You" or "disk" in line: 
                    continue
                    
                # Check if loaded
                is_loaded = "LOADED" in line
                
                models.append({
                    "id": model_id,
                    "name": model_id, # Use ID as name for now
                    "loaded": is_loaded
                })
                
        return models
    except Exception as e:
        print(f"Error listing models: {e}")
        return []

PREFERRED_VISION_MODELS = [
    "mistralai/ministral-3-14b-reasoning",
    "llava",
    "moondream",
    "vision", # Any model with 'vision' in its ID
    "minicpm",
    "yi-vl"
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
                # If no preferred vision model is found, but we are here, 
                # launch_lmstudio should have already warned or tried to load one.
                # We'll take the first one but warn.
                print(f"[AI] Warning: No preferred vision model identifier found. Using first available: {model_ids[0]}")
                return model_ids[0]
                
    except Exception as e:
        print(f"[AI] Error detecting models: {e}")
        
    return None # Return None instead of a made-up string if we really can't find one

DIAGNOSTIC_PROTOCOLS = [
    {
        "role": "ENT Radiologist",
        "focus": "Sinus & Airway",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your domain is: Sinuses (Maxillary, Ethmoid, Sphenoid, Frontal) and nasal cavities.
These structures are located in the ANTERIOR (front) of the head.

IMPORTANT RULES:
- If this slice shows the POSTERIOR (back) of the head (occipital lobe, cerebellum, posterior fossa), state: "This slice shows posterior anatomy. Sinus structures are not visible in this view."
- Only analyze structures you can ACTUALLY SEE in the image. Do NOT describe anatomy that is not present.
- If sinuses ARE visible, look for: Mucosal thickening, fluid levels, polyps, septal deviation, or airway obstruction.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Visible Region**: State which anatomical region this slice shows (anterior/middle/posterior).
2. **Identified Areas**: List ONLY the structures actually visible in THIS image.
3. **Analysis & Recommendations**: Brief analysis of visible areas only. State "Not applicable - anatomy not visible" if your domain structures are not in this slice."""
    },
    {
        "role": "Musculoskeletal Radiologist",
        "focus": "Bones & Structure",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your domain is: Facial skeleton, skull base, and bony structures.
Evaluate based on WHAT IS ACTUALLY VISIBLE in this specific slice.

IMPORTANT RULES:
- Only analyze bony structures you can ACTUALLY SEE in the image.
- Different slices show different anatomy - describe only what is present.
- Look for: Cortical integrity, marrow signal changes, fractures, erosions, or lesions in VISIBLE structures only.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Visible Region**: State which anatomical region this slice shows.
2. **Identified Areas**: List ONLY the bony structures actually visible in THIS image.
3. **Analysis & Recommendations**: Brief analysis of visible structures. If no relevant bony pathology domain structures visible, state so."""
    },
    {
        "role": "Neuroradiologist",
        "focus": "Soft Tissue & Vascular",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your domain is: Brain parenchyma, soft tissues, orbits, and vascular structures.
Evaluate based on WHAT IS ACTUALLY VISIBLE in this specific slice.

IMPORTANT RULES:
- Identify the specific brain regions visible (frontal lobe, parietal lobe, temporal lobe, occipital lobe, cerebellum, brainstem, etc.)
- Only describe structures you can ACTUALLY SEE.
- Look for: Abnormal signals, masses, inflammation, white matter changes, ventricular abnormalities, or vascular issues in VISIBLE structures.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Visible Region**: State which brain/anatomical region this slice shows (e.g., "Posterior fossa showing cerebellum and occipital lobes").
2. **Identified Areas**: List ONLY the neural/vascular structures actually visible in THIS image.
3. **Analysis & Recommendations**: Brief analysis of visible structures only."""
    },
    {
        "role": "Spine Radiologist",
        "focus": "Spine & Cord",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your domain is: Spinal column (cervical, thoracic, lumbar, sacral), intervertebral discs, spinal cord, and nerve roots.
These structures are visible in SAGITTAL or AXIAL spine-focused sequences.

IMPORTANT RULES:
- If this is a HEAD/BRAIN MRI (axial brain slices), state: "This slice shows intracranial anatomy. Spinal structures are not the primary focus."
- Only analyze spine/disc/cord structures you can ACTUALLY SEE.
- If spine IS visible, look for: Disc herniation, bulging, stenosis, cord compression, signal changes, vertebral alignment, Modic changes.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Visible Region**: State the spinal level visible (e.g., "Cervical spine C3-C7" or "Brain - spine not visible").
2. **Identified Areas**: List ONLY the spinal structures actually visible in THIS image.
3. **Analysis & Recommendations**: Brief analysis of visible structures. State "Not applicable - spine not visible" if analyzing a brain-only slice."""
    },
    {
        "role": "Oncology Radiologist",
        "focus": "Tumors & Masses",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your domain is: Detection and characterization of tumors, masses, cysts, and space-occupying lesions.
You evaluate ANY visible region for neoplastic or mass-like abnormalities.

IMPORTANT RULES:
- First identify the anatomical region shown (brain, spine, sinuses, orbits, etc.)
- Only describe lesions/masses you can ACTUALLY SEE - do NOT assume or fabricate findings.
- Look for: Abnormal masses, enhancement patterns, mass effect, edema, midline shift, cystic vs solid lesions, irregular margins.
- If NO suspicious masses are visible, clearly state: "No definite mass lesions identified in this slice."

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Visible Region**: State which anatomical region this slice shows.
2. **Mass Assessment**: Describe any masses/lesions ACTUALLY visible, or state "No masses identified."
3. **Characterization**: If mass present - location, size estimate, signal characteristics, mass effect. If none - state "Not applicable."
4. **Recommendations**: Further imaging or follow-up if indicated."""
    },
    {
        "role": "Vascular Radiologist",
        "focus": "Blood Vessels & Perfusion",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your domain is: Arterial and venous structures, flow voids, aneurysms, vascular malformations, and perfusion abnormalities.
Major intracranial vessels include: Circle of Willis, MCA, ACA, PCA, basilar artery, venous sinuses.

IMPORTANT RULES:
- Identify which vascular territories are visible based on the slice location.
- Only describe vessels and flow patterns you can ACTUALLY SEE.
- Standard MRI may have limited vascular detail - MRA/MRV sequences are better for vascular assessment.
- Look for: Flow void irregularities, aneurysms, AVMs, venous thrombosis, vascular compression.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Visible Region**: State the anatomical region and which major vessels should be in this territory.
2. **Vascular Structures Seen**: List ONLY vessels/flow voids actually visible in THIS image.
3. **Analysis & Recommendations**: Assessment of visible vascular structures. Note if dedicated MRA/MRV would be beneficial."""
    },
    {
        "role": "General Radiologist",
        "focus": "Overall Assessment",
        "prompt": """CRITICAL: First, determine what anatomical region is actually visible in this MRI slice.

Your role is: Comprehensive overview assessment across all anatomical systems visible in this slice.
You provide a unified summary that integrates findings from multiple domains.

IMPORTANT RULES:
- Identify the exact anatomical region and orientation (axial/sagittal/coronal).
- Describe ALL visible structures systematically - do not focus on just one system.
- Only describe what you can ACTUALLY SEE - avoid assumptions about adjacent slices.
- Provide a holistic impression suitable for clinical correlation.

REQUIRED OUTPUT STRUCTURE (Be Concise):
1. **Image Orientation & Region**: State plane (axial/sagittal/coronal) and anatomical level.
2. **Systematic Review**: Brief assessment of each visible system (brain, bone, soft tissue, vessels, CSF spaces).
3. **Key Findings**: Summarize any abnormalities or notable observations.
4. **Overall Impression**: One-line clinical summary."""
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

    model_id = get_active_model()
    if not model_id:
        yield f"Error: No vision model identified. Please check LM Studio."
        return

    payload = {
        "model": model_id,
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
    if not launch_lmstudio():
        yield {"type": "error", "message": "Failed to launch LM Studio or find a valid vision model."}
        return
    
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
