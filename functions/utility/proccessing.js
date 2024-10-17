const axios = require("axios");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { createCanvas, registerFont, deregisterAllFonts } = require("canvas");
const { Event } = require("../models/Event");
const { firebaseStorage } = require("../firebaseConfig");
const sharp = require("sharp");

const TEMP_DIR = os.tmpdir() || "/tmp";

const FONT_DIR = path.join(TEMP_DIR, "fonts");

if (!fs.existsSync(FONT_DIR)) {
  fs.mkdirSync(FONT_DIR);
}

const downloadGoogleFont = async (fontFamily) => {
  const fontUrl = `https://fonts.googleapis.com/css2?family=${fontFamily?.replace(
    / /g,
    "+"
  )}`;
  const response = await axios.get(fontUrl);
  const fontCss = response.data;

  const fontFileUrlMatch = fontCss.match(/url\((https:\/\/[^)]+)\)/);
  if (!fontFileUrlMatch) {
    throw new Error(
      `Could not find font file URL in Google Fonts response for ${fontFamily}`
    );
  }

  const fontFileUrl = fontFileUrlMatch[1];
  const fontFileName = `${fontFamily.replace(/ /g, "_")}.ttf`;
  const fontFilePath = path.join(FONT_DIR, fontFileName);

  if (!fs.existsSync(fontFilePath)) {
    const fontFileResponse = await axios.get(fontFileUrl, {
      responseType: "arraybuffer",
    });
    fs.writeFileSync(fontFilePath, fontFileResponse.data);
  }

  return fontFilePath;
};

const addOrUpdateGuests = async (eventId, guests) => {
  try {
    const event = await Event.findById(eventId);
    if (!event) {
      throw new Error("Event not found");
    }

    guests.forEach((guest) => {
      const existingGuestIndex = event.guests.findIndex(
        (g) => g.mobileNumber === guest.mobileNumber
      );

      if (existingGuestIndex !== -1) {
        event.guests[existingGuestIndex].name = guest.name;
        event.guests[existingGuestIndex].link =
          guest.link || event.guests[existingGuestIndex].link;
      } else {
        event.guests.push({
          name: guest.name,
          mobileNumber: guest.mobileNumber,
          link: guest.link,
        });
      }
    });

    event.processingStatus = "completed";

    await event.save();
    return event.customerId;
  } catch (error) {
    return error;
  }
};

// const createCanvasWithCenteredText = async (
//   val,
//   property,
//   scalingFont,
//   scalingH,
//   scalingW,
//   comp,
//   quality = 1,
// ) => {
//   try {
//     // Download the Google font and set the path
//     const fontPath = await downloadGoogleFont(property.fontFamily);

//     // Parse the initial font size with scaling
//     let fontSize = parseInt(property.fontSize * scalingFont * quality);

//     // Build the font string based on the initial size
//     const buildFontString = (size) => {
//       return `${property.fontStyle === "italic" ? "italic" : ""} ${
//         property.fontWeight
//       } ${size}px ${property.fontFamily}`;
//     };

//     // Register the font for use in the canvas
//     registerFont(fontPath, { family: property.fontFamily });

//     // Replace template placeholders in text with values
//     let tempTextName = property.text.replace(
//       /{(\w+)}/g,
//       (match, p1) => val[p1] || ""
//     );

//     // Set the canvas size according to the scaled width and height
//     const width = property.size.width * scalingW * quality;
//     const height = property.size.height * scalingH * quality;
//     const canvas = createCanvas(width, height);
//     const ctx = canvas.getContext("2d");

//     // Fill the background if a color is specified
//     if (property.backgroundColor !== "none") {
//       ctx.fillStyle = property.backgroundColor;
//       ctx.fillRect(0, 0, width, height);
//     }

//     // Set the initial font color
//     ctx.fillStyle = property.fontColor;

//     // Set the font and adjust size if the text exceeds the canvas width
//     ctx.font = buildFontString(fontSize);

//     while (ctx.measureText(tempTextName).width > width && fontSize > 1) {
//       fontSize--; // Decrease the font size
//       ctx.font = buildFontString(fontSize); // Rebuild the font string with the new size
//     }

//     // Set text alignment and baseline
//     ctx.textAlign = "center";
//     ctx.textBaseline = "middle";

//     // Calculate the center of the canvas for text placement
//     const x = width / 2;
//     const y = height / 2;

//     // Draw the text onto the canvas
//     ctx.fillText(tempTextName, x, y);

//     // Add underline if isUnderlined is true
//     if (property.underline === "underline") {
//       const textWidth = ctx.measureText(tempTextName).width;
//       const underlineHeight = fontSize / 15; // Set underline height relative to font size
//       const underlineY = y + fontSize / 2 + underlineHeight; // Adjust position below text

//       ctx.strokeStyle = property.fontColor; // Use the same color as the text
//       ctx.lineWidth = underlineHeight; // Thickness of the underline
//       ctx.beginPath();
//       ctx.moveTo(x - textWidth / 2, underlineY); // Start position of the underline
//       ctx.lineTo(x + textWidth / 2, underlineY); // End position of the underline
//       ctx.stroke(); // Draw the underline
//     }

//     if(comp === 'video') {
//       return canvas.toDataURL();
//     } else {
//       return await sharp(canvas.toBuffer("image/png"))
//         .sharpen() // Apply sharpening
//         .toBuffer();
//     }

//   } catch (error) {
//     throw error;
//   }
// };

// Helper function to convert HEX to RGBA
const hexToRGBA = (hex, opacity = 1) => {
  let c;
  if (/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)) {
    c = hex.substring(1).split("");
    if (c.length === 3) {
      c = [c[0], c[0], c[1], c[1], c[2], c[2]];
    }
    c = "0x" + c.join("");
    return `rgba(${(c >> 16) & 255}, ${(c >> 8) & 255}, ${
      c & 255
    }, ${opacity})`;
  }
  throw new Error("Invalid HEX color");
};

const createCanvasWithCenteredText = async (
  val,
  property,
  scalingFont,
  scalingH,
  scalingW,
  comp,
  quality = 1
) => {
  try {
    if (property?.id?.startsWith("image") && property?.link) {
      const response = await axios.get(property.link, {
        responseType: "arraybuffer",
      });
      const buffer = Buffer.from(response.data); // Convert arraybuffer to Buffer
      // return buffer;

      // Resize the image based on the given dimensions, preserving the aspect ratio and not cropping
      const resizedBuffer = await sharp(buffer)
        .resize(parseInt(property.size.width * scalingW), parseInt(property.size.height * scalingH), {
          fit: "fill", // Ensure the image fits inside the dimensions without cropping
        })
        .toBuffer(); // Convert back to buffer

      if (comp === "video") {
        // Convert buffer to base64
        const base64 = resizedBuffer.toString("base64");

        // Derive the MIME type based on the file type (you may need to adjust this depending on the file type)
        const mimeType = response.headers["content-type"]; // Assuming the content-type header contains this information

        // Create Data URL
        const dataUrl = `data:${mimeType};base64,${base64}`;

        return dataUrl;
      } else {
        return resizedBuffer;
      }
    }
    const fontPath = await downloadGoogleFont(property.fontFamily);
    let fontSize = parseInt(property.fontSize * scalingFont * quality);

    const buildFontString = (size) => {
      return `${property.fontStyle === "italic" ? "italic" : ""} ${
        property.fontWeight
      } ${size}px ${property.fontFamily}`;
    };

    registerFont(fontPath, { family: property.fontFamily });
    let tempTextName = property.text.replace(
      /{(\w+)}/g,
      (match, p1) => val[p1] || ""
    );

    const width = property.size.width * scalingW * quality;
    const height = property.size.height * scalingH * quality;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    // Handle background opacity (0-1 value). Default to 1 if none provided.
    const backgroundOpacity = property.backgroundOpacity || 1;
    if (property.backgroundColor !== "none") {
      const bgColor = hexToRGBA(property.backgroundColor, backgroundOpacity);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);
    }

    // Handle text opacity (0-1 value). Default to 1 if none provided.
    ctx.fillStyle = hexToRGBA(property.fontColor, backgroundOpacity);
    ctx.font = buildFontString(fontSize);

    while (ctx.measureText(tempTextName).width > width && fontSize > 1) {
      fontSize--;
      ctx.font = buildFontString(fontSize);
    }

    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const x = width / 2;
    const y = height / 2;

    ctx.fillText(tempTextName, x, y);

    if (property.underline === "underline") {
      const textWidth = ctx.measureText(tempTextName).width;
      const underlineHeight = fontSize / 15;
      const underlineY = y + fontSize / 2 + underlineHeight;

      ctx.strokeStyle = hexToRGBA(property.fontColor, backgroundOpacity); // Use text opacity
      ctx.lineWidth = underlineHeight;
      ctx.beginPath();
      ctx.moveTo(x - textWidth / 2, underlineY);
      ctx.lineTo(x + textWidth / 2, underlineY);
      ctx.stroke();
    }

    if (comp === "video") {
      return canvas.toDataURL();
    } else {
      return await sharp(canvas.toBuffer("image/png")).sharpen().toBuffer();
    }
  } catch (error) {
    throw error;
  }
};

const uploadFileToFirebase = async (
  fileBuffer,
  filename,
  eventId,
  isSample,
  metaContentType = "application/octet-stream"
) => {
  try {
    // Determine the destination path based on whether it's a sample or not
    const filePath = isSample
      ? `sample/${eventId}/${filename}`
      : `uploads/${eventId}/${filename}`;

    // Get a reference to the Firebase Storage file
    const storageRef = firebaseStorage.file(filePath);

    // Upload the buffer to Firebase Storage with metadata
    await storageRef.save(fileBuffer, {
      metadata: {
        contentType: metaContentType, // Default to binary stream if type is not specified
        cacheControl: "public, max-age=31536000", // Set cache control headers
      },
      resumable: false, // Avoid creating resumable uploads for small files
    });

    // Ensure the file is publicly accessible
    await storageRef.makePublic();

    // Get the public URL directly from Firebase
    const [metadata] = await storageRef.getMetadata();

    return metadata.mediaLink; // Return the public URL
  } catch (error) {
    console.error("Error uploading file to Firebase:", error.message || error);
    throw new Error("File upload failed");
  }
};

// const uploadFileToFirebase = async (fileBuffer, filename, eventId, isSample, metaContentType='application/octet-stream') => {
//   try {
//     // Determine the destination path based on whether it's a sample or not
//     const filePath = isSample
//       ? `sample/${eventId}/${filename}`
//       : `uploads/${eventId}/${filename}`;

//     // Get a reference to the Firebase Storage file
//     const storageRef = firebaseStorage.file(filePath);

//     // Upload the buffer to Firebase Storage with metadata
//     await storageRef.save(fileBuffer, {
//       metadata: {
//         contentType: metaContentType, // Default to binary stream if type is not specified
//         cacheControl: 'public, max-age=31536000', // Set cache control headers
//       },
//       resumable: false, // Avoid creating resumable uploads for small files
//     });

//     // Generate a signed URL valid for 1 hour
//     const [url] = await storageRef.getSignedUrl({
//       action: 'read',
//       expires: '03-09-2491', // Set the expiry date (here it's very long for demo purposes)
//     });

//     return url; // Return the signed URL
//   } catch (error) {
//     console.error("Error uploading file to Firebase:", error.message || error);
//     throw new Error("File upload failed");
//   }
// };

module.exports = {
  downloadGoogleFont,
  addOrUpdateGuests,
  createCanvasWithCenteredText,
  uploadFileToFirebase,
};
