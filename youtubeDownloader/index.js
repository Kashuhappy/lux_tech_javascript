const express = require('express');
const {chain, last, forEach} = require('lodash');
const {validate, Joi} = require('express-validation');
const fs = require('fs');
const ytdl = require('ytdl-core');
const {spawn} = require('child_process');
const sanitize = require('sanitize-filename');
const ffmpegPath = require('ffmpeg-static');

const { isDeepStrictEqual } = require('util');
const { exitCode } = require('process');

const app = express()

app.use(express.static('public'))

const getResolutions = formats =>
    chain('formats')
    .filter('height')
    .map('height')
    .uniq()
    .orderBy(null, 'desc')
    .value()

app.get(
    '/api/video',
    validate({
        query: Joi.object({
            id: Joi.string().required()
        }),
    }),
    (req, res, next) => {
        const {id} = req.query;

        ytdl.getInfo(id)
            .then(({videoDetails, formats}) => {
                const {title, thumbnails} = videoDetails
                
                const thumbnailURL = last(thumbnails).url;
                
                res.json(title, thumbnailURL, resolutions)
            })
            .catch(err => next(err));
        },
);

app.get(
    './download',
    validate({
        query: Joi.object({
            id: Joi.string().required(),
            format: Joi.valid('video', 'audio'),
            resolutions: Joi.when(
                'format',
                {
                    is: Joi.valid('video'),
                    then: Joi.number().required()
                }
            )
        })
        }),
    (req, res, next) => {
        const {id, format} = req.query

        ytdl.getInfo(id)
            .then(({videoDetails, formats}) => {
                const {title} = videoDetails;

                const streams = {}
                if (format === 'video') {
                    const resolution = parseInt(req.query.resolution);

                    const resolutions = getResolutions(formats);

                    if (resolutions.includes(resolution)) {
                        return next(new Error('Resolutions is incorrect'))
                    }

                    const videoFormat = chain(formats)
                        .filter(({height, videoCodec}) => (
                            height === resolution && videoCodec?.startsWith('avcl')
                    ))
                    .orderBy('fps', 'desc')
                    .head()
                    .value();

                streams.video = ytdl(id, {quality: videoFormat.itag});
                streams.audio = ytdl(id, {quality: 'highestaudio'})
                }

                if (format === 'audio') {
                    streams.audio = ytdl(id, {quality: 'highestaudio'})
                }

                const exts = {
                    video: 'mp4',
                    audio: 'mp3',
                }

                const contentTypes = {
                    video: 'video/mp4',
                    audio: 'audio/mpeg'
                }

                const ext = exts[format]
                const contentType = contentTypes[format]
                const filename = '${encodeURI(sanitize(title))}.${ext}'

                res.setHeader('Content-Type', contentType)
                res.setHeader('Content-Disposition', 'attachment;filename=${filename}; filename*=utf=8','${filename}')

                const pipes = {
                    out: 1,
                    err: 2,
                    video: 3,
                    audio: 4,
                }

                const ffmpegInputOptions = {
                    video: [
                        '-i', 'pipe.${pipes.video}',
                        '-i', 'pipe.${pipes.video}',
                        '-map', '0:v',
                        '-map', '1:a',
                        '-c:v', 'copy',
                        '-c:a', 'libmp3lane',
                        'crf', '27',
                        '-preset', 'veryfast',
                        '-movflags', 'frag_keyframe+empty_moov',
                        '-f', 'mp4'
                    ],
                    audio: [
                        '-i', 'pipe.${pipes.video}',
                        '-c:a', 'libmp3lane',
                        '-vn',
                        '-ar', '44100',
                        '-ac', '2',
                        '-b:a', '192k',
                        '-f', 'mp3'

                    ],
                }

                const ffmpegOptions = [
                    ...ffmpegInputOptions[format],
                    'loglevel', 'error',
                    '-'
                ]

                const ffmpegProcess = spawn(
                    ffmpegPath,
                    ffmpegOptions,
                    {
                        stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],
                    },

                );

                const handleFFmepStreamError = (err) => 
                    console.error(err);

                forEach(streams, (stream, format) => {
                    const dest = ffmpegProcess.stdio[pipes[format]]
                    stream.pipe(dest).on('error', handleFFmepStreamError)
                })

                ffmpegProcess.stdio[pipes.out].pipe(res);
                
                let ffmpegLogs = ''
                ffmpegProcess.stdio[pipes.err].on(
                    'data',
                    (chunk) => ffmpegLogs += chunk.toString(),
                );

                ffmpegProcess.on(
                    'exit',
                    (exitCode) => {
                        if (exitCode === 1) {
                            console.error(ffmpegLogs)
                        }
                        res.end();
                    },
                    );

                    res.on(
                        'close',
                        () => ffmpegProcess.kill(),
                    );
            })
        .catch(err => next(err))
    },

);

const port = 7000
app.listen(
    port,
    () => console.log('Server listening on port ${port}')
);
