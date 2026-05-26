
# Acknowledgments

Both "ECB Mode Visualizer" and "Image Metadata Viewer" tools have been inspired by my own or by my student's needs and coded using AI.

## ECB Mode Visualizer
The ECB mode visualizer is a tool inspired by the ECB Penguin demonstration from @robertdavidgraham:
https://github.com/robertdavidgraham/ecb-penguin

This tool aims to make a real-life demo on how using an encryption mode that works by encrypting blocks independently can still leave visible patterns in the encrypted data.
It is recommended to be used with flat images, such as logos, as it is way easier for the details to remain clearly distinguishable.

## Image Metadata Viewer
This tool originated from my own need to verify an image’s authorship through metadata analysis. Having also designed various CTF challenges—some involving steganography—I wanted to create a tool capable of analyzing all metadata fields alongside several common steganographic techniques.

To preserve confidentiality and avoid handling sensitive data, the Image Metadata Viewer performs all processing locally, without uploading the analyzed images.