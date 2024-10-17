const express = require("express");
const fs = require("fs");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
const { authenticateJWT } = require("../middleware/auth");
const {
  createCanvasWithCenteredText,
  addOrUpdateGuests,
  uploadFileToFirebase,
} = require("../utility/proccessing");
const createTransaction = require("../utility/creditTransiction");
const os = require("os");
const { User } = require("../models/User");
const { firebaseStorage } = require("../firebaseConfig");
const { SampleGuestList } = require("../constants");
const { Event } = require("../models/Event");

ffmpeg.setFfmpegPath(ffmpegPath);
ffmpeg.setFfprobePath(ffmpegPath);

const router = express.Router();

const UPLOAD_DIR = os.tmpdir() || path.join(__dirname, "../tmp");

const createVideoForGuest = (
  { metaContentType, metaFileExt },
  inputPath,
  texts,
  scalingFont,
  scalingH,
  scalingW,
  val,
  i,
  videoDuration,
  isSample,
  eventId
) => {
  return new Promise(async (resolve, reject) => {
    const streams = await Promise.all(
      texts.map(async (text) => {
        const stream = await createCanvasWithCenteredText(
          val,
          text,
          scalingFont,
          scalingH,
          scalingW,
          "video"
        );
        return { ...text, stream };
      })
    );

    const outputFilename = `processed_video_${i}_${Date.now()}.mp4`;
    const tempOutputPath = path.join(UPLOAD_DIR, outputFilename);

    const processedVideo = ffmpeg().input(inputPath);

    streams.map((text) => {
      processedVideo.input(text.stream).loop(0.1); // change the loop time
    });

    processedVideo.loop(videoDuration);

    const configuration = streams.flatMap((text, idx) => {
      const xPos = parseInt(text.position.x * scalingW);
      const yPos = parseInt(text.position.y * scalingH + 5);

      let filterConfig = {
        filter: "overlay",
        options: {
          x: xPos,
          y: yPos,
          enable: `between(t,${parseInt(text.startTime)},${parseInt(
            text.duration // this is end time
          )})`,
        },
        inputs: idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
        outputs: idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
      };

      // Add transition filter if specified
      if (text.transition) {
        switch (text.transition.type) {
          case "move_up":
            let moveToTop = 50;
            filterConfig = {
              filter: "overlay",
              options: {
                x: xPos,
                y: `if(lt(t,${text.startTime}+${
                  text.transition.options.duration
                }), (${yPos + moveToTop} + (t-${text.startTime})*(${yPos}-${
                  yPos + moveToTop
                })/${text.transition.options.duration}), ${yPos})`,
                enable: `between(t,${text.startTime},${text.duration})`,
              },
              inputs:
                idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
              outputs:
                idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
            };
            break;
          case "move_down":
            let moveToBottom = 50;
            filterConfig = {
              filter: "overlay",
              options: {
                x: xPos,
                y: `if(lt(t,${text.startTime}+${
                  text.transition.options.duration
                }), (${yPos - moveToBottom} + (t-${text.startTime})*(${yPos}-${
                  yPos - moveToBottom
                })/${text.transition.options.duration}), ${yPos})`,
                enable: `between(t,${text.startTime},${text.duration})`,
              },
              inputs:
                idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
              outputs:
                idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
            };
            break;
          case "move_right":
            let moveToRight = 50;
            filterConfig = {
              filter: "overlay",
              options: {
                x: `if(lt(t,${text.startTime}+${
                  text.transition.options.duration
                }), (${xPos - moveToRight} + (t-${text.startTime})*(${xPos}-${
                  xPos - moveToRight
                })/${text.transition.options.duration}), ${xPos})`,
                y: yPos,
                enable: `between(t,${text.startTime},${text.duration})`,
              },
              inputs:
                idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
              outputs:
                idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
            };
            break;
          case "move_left":
            let moveToLeft = 50;
            filterConfig = {
              filter: "overlay",
              options: {
                x: `if(lt(t,${text.startTime}+${
                  text.transition.options.duration
                }), (${xPos + moveToLeft} + (t-${text.startTime})*(${xPos}-${
                  xPos + moveToLeft
                })/${text.transition.options.duration}), ${xPos})`,
                y: yPos,
                enable: `between(t,${text.startTime},${text.duration})`,
              },
              inputs:
                idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
              outputs:
                idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
            };
            break;
          case "path_cover":
            const rotationSpeed =
              1 / parseInt(text.transition.options.duration);
            // const clockwise = text?.transition?.options?.clockwise !== false; // Default to clockwise if not specified
            const clockwise = true;

            filterConfig = {
              filter: "overlay",
              options: {
                x: `if(lt(t,${text.startTime}),${xPos},if(lt(t,${
                  text.startTime
                } + 1/${rotationSpeed}),${xPos} + (overlay_w/5) * cos(2*PI*${
                  clockwise ? "" : "-"
                }${rotationSpeed}*(t-${text.startTime})),${xPos}))`,
                y: `if(lt(t,${text.startTime}),${yPos},if(lt(t,${
                  text.startTime
                } + 1/${rotationSpeed}),${yPos} + (overlay_h/5) * sin(2*PI*${
                  clockwise ? "" : "-"
                }${rotationSpeed}*(t-${text.startTime})),${yPos}))`,
                enable: `between(t,${text.startTime},${text.duration})`,
                eval: "frame",
              },
              inputs:
                idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
              outputs:
                idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
            };
            break;
          case "fade":
            const fadeConfig = [
              {
                filter: "fade",
                options: {
                  type: "in",
                  start_time: text.startTime,
                  duration: text.transition.options.duration, // Fade duration in seconds
                },
                inputs: `[${idx + 1}:v]`, // Each input stream (starting from 1) (if not working change to 1:v)
                outputs: `fade${idx + 1}`,
              },
              {
                filter: "overlay",
                options: {
                  x: xPos,
                  y: yPos,
                  enable: `between(t,${parseInt(text.startTime)},${parseInt(
                    text.duration
                  )})`,
                },
                inputs:
                  idx === 0 ? "[0:v][fade1]" : `[tmp${idx}][fade${idx + 1}]`,
                outputs:
                  idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
              },
            ];
            return fadeConfig;
          case "slide":
            moveToTop = 50;
            moveToBottom = 50;
            moveToLeft = 50;
            moveToRight = 50;
            filterConfig = {
              filter: "overlay",
              options: {
                x: `if(lt(t,${text.startTime}+${
                  text.transition.options.duration
                }), (${xPos - moveToLeft} + (t-${text.startTime})*(${
                  xPos + moveToRight
                }-${xPos - moveToLeft})/${text.transition.options.duration}), ${
                  xPos + moveToRight
                })`,
                y: `if(lt(t,${text.startTime}+${
                  text.transition.options.duration
                }), (${yPos - moveToTop} + (t-${text.startTime})*(${
                  yPos + moveToBottom
                }-${yPos - moveToTop})/${text.transition.options.duration}), ${
                  yPos + moveToBottom
                })`,
                enable: `between(t,${text.startTime},${text.duration})`,
              },
              inputs:
                idx === 0 ? ["0:v", "1:v"] : [`[tmp${idx}]`, `${idx + 1}:v`],
              outputs:
                idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
            };
            break;
          case "zoom_out":
            const zoomOutConfig = [
              {
                filter: "zoompan",
                options: {
                  z: `if(lte(on,0),1, min(pzoom+0.01,2))`, // Incremental zoom (starts at 1 and gradually zooms in)
                  d: text.transition.options.duration, // Duration of the effect (30 FPS)
                  x: "(iw/2)-(iw/zoom/2)", // Keep the image horizontally centered
                  y: "(ih/2)-(ih/zoom/2)", // Keep the image vertically centered
                  s: `${parseInt(text.size.width * scalingW)}x${parseInt(
                    text.size.height * scalingH
                  )}`, // Define the scaling size
                },
                inputs: `[${idx + 1}:v]`,
                outputs: `zoom_out_${idx + 1}`,
              },
              {
                filter: "overlay",
                options: {
                  x: xPos,
                  y: yPos,
                  enable: `between(t,${parseInt(text.startTime)},${parseInt(
                    text.duration
                  )})`,
                },
                inputs:
                  idx === 0
                    ? "[0:v][zoom_out_1]"
                    : `[tmp${idx}][zoom_out_${idx + 1}]`,
                outputs:
                  idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
              },
            ];
            return zoomOutConfig;

          case "zoom_in":
            const zoomInConfig = [
              {
                filter: "zoompan",
                options: {
                  z: `if(lte(on,0),2, max(pzoom-0.01,1))`, // Start zoomed in at 2x and gradually zoom out
                  d: text.transition.options.duration, // Duration of the effect
                  x: "(iw/2)-(iw/zoom/2)", // Keep the image horizontally centered
                  y: "(ih/2)-(ih/zoom/2)", // Keep the image vertically centered
                  s: `${parseInt(text.size.width * scalingW)}x${parseInt(
                    text.size.height * scalingH
                  )}`, // Define the scaling size
                },
                inputs: `[${idx + 1}:v]`,
                outputs: `zoom_in_${idx + 1}`,
              },
              {
                filter: "overlay",
                options: {
                  x: xPos,
                  y: yPos,
                  enable: `between(t,${parseInt(text.startTime)},${parseInt(
                    text.duration
                  )})`,
                },
                inputs:
                  idx === 0
                    ? "[0:v][zoom_in_1]"
                    : `[tmp${idx}][zoom_in_${idx + 1}]`,
                outputs:
                  idx === streams.length - 1 ? "result" : `[tmp${idx + 1}]`,
              },
            ];
            return zoomInConfig;

          default:
            break;
        }
      }

      return filterConfig;
    });

    processedVideo
      .complexFilter(configuration, "result")
      .outputOptions(["-c:v libx264", "-c:a aac", "-map 0:a:0?"])
      .output(tempOutputPath)
      .on("end", async () => {
        try {
          const filename =
            `${val?.name}_${val?.mobileNumber}_processed${metaFileExt}`.replace(
              /\s+/g,
              "_"
            );

          const url = await uploadFileToFirebase(
            fs.readFileSync(tempOutputPath),
            filename,
            eventId,
            isSample,
            metaContentType
          );

          if (fs.existsSync(tempOutputPath)) {
            fs.rmSync(tempOutputPath);
          }

          val.link = url;
          resolve(url);
        } catch (uploadError) {
          reject(uploadError);
        }
      })
      .on("error", (err) => {
        reject(err);
      })
      .run();
  });
};

// Helper function to chunk an array into smaller arrays of a specified size
const chunkArray = (array, chunkSize) => {
  return array.reduce((acc, _, i) => {
    if (i % chunkSize === 0) acc.push(array.slice(i, i + chunkSize));
    return acc;
  }, []);
};

router.post("/", authenticateJWT, async (req, res) => {
  let inputPath;
  try {
    const {
      textProperty,
      scalingFont,
      scalingW,
      scalingH,
      isSample,
      videoDuration,
      fileName,
    } = req.body;
    let { guestNames } = req.body;

    const eventId = req?.query?.eventId;
    if (!eventId) throw new Error("Required Event Id");

    const event = await Event.findById(eventId);
    if (!event) throw new Error("Event not found");

    if(!isSample) {
      event.processingStatus = "processing";
      await event.save();
    }

    const storageRef = firebaseStorage.file(`uploads/${eventId}/${fileName}`);

    const [inputBuffer] = await storageRef.download(); // Get the file as a Buffer

    const [metadata] = await storageRef.getMetadata();
    const metaFileExt = metadata?.name?.replace(
      `uploads/${eventId}/inputFile`,
      ""
    );
    const metaContentType = metadata.contentType;

    inputPath = path.join(UPLOAD_DIR, `inputFile${Date.now()}.mp4`);
    fs.writeFileSync(inputPath, Buffer.from(inputBuffer));

    let amountSpend;

    if (textProperty?.length === 0) {
      throw new Error("First Put some text box");
    }

    const user = await User.findById(req.user._id);
    if (!user) throw new Error("User not found");

    if (isSample) {
      guestNames = SampleGuestList;
    } else {
      amountSpend = 1 * guestNames.length;

      if (user.credits - amountSpend <= 0)
        throw new Error("Insufficient Balance");
    }

    if (!textProperty || !inputPath) {
      throw new Error("Please provide the guest list and video.");
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    setImmediate(() => {
      (async () => {
        // Control concurrency to avoid overwhelming the server
        const concurrencyLimit = 10;
        const chunks = chunkArray(guestNames, concurrencyLimit);

        for (const chunk of chunks) {
          await Promise.all(
            chunk.map(async (val, i) => {
              await createVideoForGuest(
                { metaContentType, metaFileExt },
                inputPath,
                textProperty,
                scalingFont,
                scalingH,
                scalingW,
                val,
                i,
                videoDuration,
                isSample,
                eventId
              );

              // Send update to the client
              res.write(`data: ${JSON.stringify(val)}\n\n`);
            })
          );
        }

        if (!isSample) {
          const customerId = await addOrUpdateGuests(eventId, guestNames);
          await createTransaction(
            "video",
            req.user._id,
            null,
            amountSpend,
            "completed",
            eventId,
            customerId
          );
        }

        res.end();
      })().then(() => {
        if (fs.existsSync(inputPath)) {
          fs.unlinkSync(inputPath);
        }
      });
    });
  } catch (error) {
    res.status(400).json({ message: error.message });
    res.end();
  }
});

module.exports = router;

// const createCanvasWithCenteredText = async (
//   val,
//   property,
//   scalingFont,
//   scalingH,
//   scalingW
// ) => {
//   const fontPath = await downloadGoogleFont(property.fontFamily);
//   registerFont(fontPath, { family: property.fontFamily });

//   let tempTextName = property.text.replace(
//     /{(\w+)}/g,
//     (match, p1) => val[p1] || ""
//   );
//   let width = parseInt(property.size.width * scalingW);
//   let height = parseInt(property.size.height * scalingH);

//   width = width % 2 ? width + 1 : width;
//   height = height % 2 ? height + 1 : height;

//   const canvas = createCanvas(width, height);
//   const ctx = canvas.getContext("2d");

//   if (property.backgroundColor !== "none") {
//     ctx.fillStyle = property.backgroundColor;
//     ctx.fillRect(0, 0, width, height);
//   } else {
//     ctx.clearRect(0, 0, width, height); // Clear the canvas for transparency
//   }

//   ctx.fillStyle = property.fontColor;

//   let fontSize = property.fontSize * scalingFont;
//   ctx.font = `${fontSize}px ${property.fontFamily}`;

//   // Adjust font size to fit text within canvas width
//   while (ctx.measureText(tempTextName).width > width && fontSize > 1) {
//     fontSize--;
//     ctx.font = `${fontSize}px ${property.fontFamily}`;
//   }

//   ctx.textAlign = "center";
//   ctx.textBaseline = "middle";

//   const x = width / 2;
//   const y = height / 2;
//   ctx.fillText(tempTextName, x, y);

//   deregisterAllFonts();

//   return canvas.toDataURL();
// };
