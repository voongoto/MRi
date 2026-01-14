import os
import base64
import json
import requests
import argparse
import math
from typing import List, Dict, Any
from PIL import Image, ImageDraw, ImageFont

LMSTUDIO_URL = "http://localhost:1234/v1/chat/completions"

def encode_image(image_path: str) -> str:
    """Encode an image as a base64 string."""
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode("utf-8")

def encode_pil_image(img: Image.Image) -> str:
    """Encode a PIL image as a base64 string."""
    import io
    buffered = io.BytesIO()
    img.save(buffered, format="JPEG")
    return base64.b64encode(buffered.getvalue()).decode("utf-8")

def analyze_image(image_data: str, prompt: str, is_path: bool = True) -> str:
    """Send image data to LMStudio for analysis."""
    if is_path:
        base64_image = encode_image(image_data)
    else:
        base64_image = image_data
    
    payload = {
        "model": "llava-1.6-mistral-7b",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/jpeg;base64,{base64_image}"
                        }
                    }
                ]
            }
        ],
        "temperature": 0.2,
    }
    
    try:
        response = requests.post(LMSTUDIO_URL, json=payload, timeout=60)
        response.raise_for_status()
        result = response.json()
        return result["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Error analyzing image: {str(e)}"

def create_grid_image(image_paths: List[str], cols: int = 4) -> Image.Image:
    """Stitch images into a grid."""
    if not image_paths:
        return None
        
    images = [Image.open(p) for p in image_paths]
    w, h = images[0].size
    
    rows = math.ceil(len(images) / cols)
    grid_img = Image.new('RGB', (cols * w, rows * h), color=(0, 0, 0))
    
    for idx, img in enumerate(images):
        x = (idx % cols) * w
        y = (idx // cols) * h
        grid_img.paste(img, (x, y))
        
        # Add label for each slice
        draw = ImageDraw.Draw(grid_img)
        label = os.path.basename(image_paths[idx])
        draw.text((x + 5, y + 5), label, fill=(255, 255, 0))
        
    return grid_img

def list_mri_series(base_dir: str) -> List[Dict[str, str]]:
    """Discover MRI series in the patient directories."""
    series_list = []
    # Identify patient directories (starting with Patient_sName__)
    try:
        patient_dirs = [d for d in os.listdir(base_dir) if d.startswith("Patient_sName__") and os.path.isdir(os.path.join(base_dir, d))]
    except Exception as e:
        print(f"Error accessing directory {base_dir}: {e}")
        return []
    
    for p_dir in patient_dirs:
        img_root = os.path.join(base_dir, p_dir, "img")
        if not os.path.exists(img_root):
            continue
            
        # Explore imports
        for import_dir in os.listdir(img_root):
            import_path = os.path.join(img_root, import_dir)
            if not os.path.isdir(import_path):
                continue
                
            # Series directories are 00000000, 00000001, etc.
            for s_dir in os.listdir(import_path):
                s_path = os.path.join(import_path, s_dir)
                if not os.path.isdir(s_path):
                    continue
                
                # Check for images
                images = sorted([f for f in os.listdir(s_path) if f.endswith(".jpg")])
                if images:
                    series_list.append({
                        "id": f"{p_dir}/{import_dir}/{s_dir}",
                        "name": f"{p_dir} | {s_dir}",
                        "path": s_path,
                        "image_count": len(images)
                    })
    return series_list

def main():
    parser = argparse.ArgumentParser(description="Analyze MRI images using LMStudio.")
    parser.add_argument("--dir", default=".", help="Base directory containing MRI data")
    parser.add_argument("--prompt", default="Analyze these MRI slices. Identify any notable features, anatomical variations, or potential abnormalities. Provide a summary of the findings.", help="Prompt for the vision model")
    parser.add_argument("--sample", type=int, default=1, help="Analyze every N-th image in a series")
    parser.add_argument("--grid", type=int, default=16, help="Number of slices per grid image (e.g. 16 for 4x4)")
    parser.add_argument("--series", help="Specific series ID index to analyze")
    
    args = parser.parse_args()
    
    series = list_mri_series(args.dir)
    
    if not series:
        print("No MRI series found.")
        return
        
    selected_series = None
    if args.series is not None:
        try:
            idx = int(args.series)
            if 0 <= idx < len(series):
                selected_series = series[idx]
        except ValueError:
            selected_series = next((s for s in series if s["id"] == args.series), None)
            
    if not selected_series:
        print("\nAvailable MRI Series:")
        for idx, s in enumerate(series):
            print(f"[{idx}] {s['id']} ({s['image_count']} images)")
        
        choice = input("\nSelect a series index to analyze (or 'q' to quit): ")
        if choice.lower() == 'q':
            return
        try:
            selected_series = series[int(choice)]
        except (ValueError, IndexError):
            print("Invalid selection.")
            return

    # Get images in the series
    all_images = sorted([f for f in os.listdir(selected_series["path"]) if f.endswith(".jpg")])
    images = all_images[::args.sample]
    
    print(f"\nProcessing {len(images)} slices from {selected_series['id']}...")
    
    # Process slices in grid batches
    grid_size = args.grid
    num_grids = math.ceil(len(images) / grid_size)
    
    for g in range(num_grids):
        start_idx = g * grid_size
        end_idx = min((g + 1) * grid_size, len(images))
        batch_paths = [os.path.join(selected_series["path"], images[i]) for i in range(start_idx, end_idx)]
        
        print(f"Creating grid for slices {start_idx} to {end_idx-1}...")
        grid_img = create_grid_image(batch_paths, cols=int(math.sqrt(grid_size)))
        
        if grid_img:
            # For debugging/verification, you could save the grid
            # grid_img.save(f"debug_grid_{g}.jpg")
            
            print(f"Sending grid {g+1}/{num_grids} to LMStudio for analysis...")
            b64_data = encode_pil_image(grid_img)
            analysis = analyze_image(b64_data, args.prompt, is_path=False)
            
            print(f"\n--- Analysis Result (Grid {g+1}/{num_grids}) ---\n")
            print(analysis)
            print("\n" + "="*50 + "\n")

if __name__ == "__main__":
    main()
