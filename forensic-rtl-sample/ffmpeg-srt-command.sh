ffmpeg -hide_banner -y -i INPUT.mp4 -vf "subtitles=sample-source.srt:force_style='Fontname=Vazirmatn,Alignment=2'" -c:v libx264 -preset fast -crf 23 -c:a aac OUT_srt_direct.mp4
