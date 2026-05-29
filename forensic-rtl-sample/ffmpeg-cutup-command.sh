ffmpeg -hide_banner -y -i INPUT.mp4 -vf "scale=1080:1920,ass=subtitles.ass" -c:v libx264 -preset fast -crf 23 -c:a aac OUT_cutup_ass.mp4
