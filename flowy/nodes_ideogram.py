import time
import requests
import base64
import io
from PIL import Image
import torch
import numpy as np
import logging
import json
from .types import STRING, INT, API_HOST
from .utils import logger, get_nested_value
from .api_key_manager import load_api_key

logger = logging.getLogger(__name__)

class FlowyIdeogram:
    @classmethod
    def INPUT_TYPES(s):
        return {
            "required": {
                "prompt": ("STRING", {"multiline": True}),
                "negative_prompt": ("STRING", {"multiline": True}),
                "version": (["ideogram-v2-turbo", "ideogram-v2"],),
                "resolution": (["None", "512x1536", "576x1408", "576x1472", "576x1536", "640x1024", "640x1344", "640x1408", "640x1472", "640x1536", "704x1152", "704x1216", "704x1280", "704x1344", "704x1408", "704x1472", "720x1280", "736x1312", "768x1024", "768x1088", "768x1152", "768x1216", "768x1232", "768x1280", "768x1344", "832x960", "832x1024", "832x1088", "832x1152", "832x1216", "832x1248", "864x1152", "896x960", "896x1024", "896x1088", "896x1120", "896x1152", "960x832", "960x896", "960x1024", "960x1088", "1024x640", "1024x768", "1024x832", "1024x896", "1024x960", "1024x1024", "1088x768", "1088x832", "1088x896", "1088x960", "1120x896", "1152x704", "1152x768", "1152x832", "1152x864", "1152x896", "1216x704", "1216x768", "1216x832", "1232x768", "1248x832", "1280x704", "1280x720", "1280x768", "1280x800", "1312x736", "1344x640", "1344x704", "1344x768", "1408x576", "1408x640", "1408x704", "1472x576", "1472x640", "1472x704", "1536x512", "1536x576", "1536x640"],),
                "style_type": (["None", "Auto", "Realistic", "Design", "Anime", "Render 3D"],),
                "aspect_ratio": (["1:1", "4:3", "3:4", "16:9", "9:16", "3:2", "2:3", "16:10", "10:16", "3:1", "1:3"],),
                "magic_prompt_option": (["On", "Off"],),
                "seed": ("INT", {"default": 0, "min": 0, "max": 2147483647}), 
            }
        }

    RETURN_TYPES = ("IMAGE",)
    FUNCTION = "generate_image_with_ideogram"
    CATEGORY = "Comflowy"
    DESCRIPTION = """
Nodes from https://comflowy.com: 
- Description: A service to generate images using Ideogram AI.
- How to use: 
    - Provide a prompt to generate an image.
    - Choose resolution, style type, aspect ratio, and magic prompt option.
    - Resolution overrides aspect ratio. 
    - Magic Prompt will interpret your prompt and optimize it to maximize variety and quality of the images generated. You can also use it to write prompts in different languages.
    - Make sure to set your API Key using the 'Comflowy Set API Key' node before using this node.
- Output: Returns the generated image.
"""

    def generate_image_with_ideogram(self, prompt, negative_prompt, version, resolution, style_type, aspect_ratio, magic_prompt_option, seed):
        api_key = load_api_key()
        
        if not api_key:
            error_msg = "API Key is not set. Please use the 'Comflowy Set API Key' node to set a global API Key before using this node."
            logger.error(error_msg)
            raise ValueError(error_msg)

        logger.info(f"开始处理 Ideogram 图像生成请求。prompt: {prompt}, negative_prompt: {negative_prompt}, resolution: {resolution}, style_type: {style_type}, aspect_ratio: {aspect_ratio}, magic_prompt_option: {magic_prompt_option}, seed: {seed}")

        try:
            response = requests.post(
                f"{API_HOST}/api/open/v0/ideogram",
                headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
                json={
                    "prompt": prompt,
                    "negative_prompt": negative_prompt,
                    "version": version, 
                    "resolution": resolution if resolution != "None" else None,
                    "style_type": style_type if style_type != "None" else None,
                    "aspect_ratio": aspect_ratio,
                    "magic_prompt_option": magic_prompt_option,
                    "seed": seed,
                }
            )
            response.raise_for_status()
            result = response.json()

            logger.info(f"API 请求完成。状态码: {response.status_code}")
            logger.debug(f"API 响应内容: {json.dumps(result, indent=2)}")

            if not result.get('success'):
                logger.error(f"API 请求失败。响应内容: {json.dumps(result, indent=2)}")
                raise Exception(f"API 请求失败。响应内容: {json.dumps(result, indent=2)}")

            output_url = result.get('data', {}).get('output')
            if not output_url or not isinstance(output_url, str):
                logger.error(f"完整的 API 响应: {json.dumps(result, indent=2)}")
                raise Exception(f"无法获取有效的输出图像 URL。API 响应中没有预期的数据结构。完整响应: {json.dumps(result, indent=2)}")

            logger.info(f"获取到的输出 URL: {output_url}")

            # 验证 URL 是否可访问
            try:
                url_check = requests.head(output_url)
                url_check.raise_for_status()
            except requests.RequestException as e:
                logger.error(f"无法访问输出 URL: {str(e)}")
                raise Exception(f"无法访问输出 URL: {str(e)}")

            # 添加延迟,等待 Replicate 处理完成
            time.sleep(10)

            img_response = requests.get(output_url, stream=True)
            img_response.raise_for_status()

            # 将图像数据转换为 PIL Image
            img = Image.open(img_response.raw)

            # 转换为 numpy 数组
            img_np = np.array(img)

            # 确保图像是 3 通道 RGB
            if len(img_np.shape) == 2:  # 灰度图像
                img_np = np.stack([img_np] * 3, axis=-1)
            elif img_np.shape[-1] == 4:  # RGBA 图像
                img_np = img_np[:, :, :3]

            # 转换为 float32 并归一化到 0-1 范围
            img_np = img_np.astype(np.float32) / 255.0

            # 转换为 torch tensor，确保形状为 [B,H,W,C]
            img_tensor = torch.from_numpy(img_np).unsqueeze(0)  # 添加批次维度

            logger.info(f"图像处理完成。输出张量形状: {img_tensor.shape}")

            return (img_tensor,)

        except Exception as e:
            error_msg = f"图像生成过程中出错: {str(e)}"
            logger.error(error_msg)
            logger.exception("详细错误信息:")
            # 返回一个错误标记图像，确保形状为 [B,H,W,C]
            error_image = torch.zeros((1, 100, 400, 3), dtype=torch.float32)
            return (error_image,)