import sys
import cv2
import requests
import numpy as np
import os

try:
    # Check if a Cloudinary URL was provided
    if len(sys.argv) < 2:
        raise ValueError("No Cloudinary URL provided. Please specify an image URL.")

    # Get the Cloudinary URL from command-line arguments
    cloudinary_url = sys.argv[1]
    print(f"Loading image from Cloudinary URL: {cloudinary_url}")

    # Download the image from Cloudinary
    response = requests.get(cloudinary_url)
    if response.status_code != 200:
        raise ValueError(f"Failed to download image from Cloudinary URL: {cloudinary_url}")

    # Convert the response content to a NumPy array and decode the image
    image_array = np.asarray(bytearray(response.content), dtype=np.uint8)
    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Failed to decode the image.")

    # Convert the image to grayscale
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # Threshold the image
    _, thresholded = cv2.threshold(gray, 127, 255, cv2.THRESH_BINARY)

    # Find contours in the thresholded image
    contours, _ = cv2.findContours(thresholded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError("No contours found in the image.")

    # Find the largest contour
    largest_contour = max(contours, key=cv2.contourArea)

    # Get the bounding rectangle for the largest contour
    x, y, w, h = cv2.boundingRect(largest_contour)

    # Crop the image to this bounding rectangle
    cropped = image[y:y+h, x:x+w]

    # Save the processed image to a temporary file
    temp_filename = "processed_image.jpg"
    cv2.imwrite(temp_filename, cropped)

    # Print the path to the processed image
    print(temp_filename)

except Exception as e:
    print(f"Error: {str(e)}")
    sys.exit(1)
