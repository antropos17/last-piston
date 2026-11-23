"""Local Blender motor builder. With no arguments, open the Windows desktop form."""
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]

def build(count, litres, wear, fault, target, progress):
    blender = os.environ.get("BLENDER_PATH") or shutil.which("blender")
    if not blender and Path("X:/Blender/blender.exe").is_file():
        blender = "X:/Blender/blender.exe"
    if not blender:
        raise RuntimeError("Укажите путь к blender.exe в переменной BLENDER_PATH.")
    env = os.environ.copy()
    env["PYTHONUTF8"] = "1"
    edge = Path(os.environ.get("ProgramFiles(x86)", ""))/"Microsoft/Edge/Application/msedge.exe"
    if edge.is_file():
        env.setdefault("CHROMIUM_PATH", str(edge))
    python = Path(sys.executable).with_name("python.exe") if os.name=="nt" else Path(sys.executable)
    from importlib.util import find_spec
    if find_spec("playwright"):
        command = [str(python)]
    elif shutil.which("uv"):
        command = ["uv","run","--no-project","--offline","--with","playwright","python"]
    else:
        raise RuntimeError("Нужен Python с Playwright или доступный локальный кэш uv с Playwright.")
    def run(cmd):
        result = subprocess.run(cmd, env=env, cwd=ROOT, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, encoding="utf-8", errors="replace",
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if result.returncode:
            raise RuntimeError(result.stdout[-1600:])
    target = target.resolve()
    if target.suffix.lower() != ".blend":
        raise ValueError("Выберите файл с расширением .blend")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".motor-", dir=target.parent) as stage:
        stage = Path(stage)
        progress("Записывается двигатель и стереозвук…")
        run(command+[str(HERE/"capture.py"),"--cylinders",str(count),"--litres",str(litres),
                     "--wear",str(wear/100),"--fault",fault,"--output",str(stage)])
        progress("Blender собирает геометрию и анимацию…")
        run([blender,"-b","-noaudio","--python-exit-code","1","--python",str(HERE/"assemble.py"),
             "--","--take",str(stage),"--out",str(stage/"assembled.blend")])
        os.replace(stage/"assembled.blend",target)
    return blender

def form():
    import tkinter as tk
    from tkinter import ttk, filedialog, messagebox
    from queue import Queue, Empty
    app=tk.Tk();app.title("Last Piston · Конструктор для Blender");app.resizable(False,False)
    frame=ttk.Frame(app,padding=20);frame.grid(sticky="nsew")
    ttk.Label(frame,text="Новый двигатель",font=("Segoe UI",16,"bold")).grid(row=0,column=0,columnspan=2,sticky="w",pady=(0,12))
    fields=[]
    for i,(name,choices,default) in enumerate([
        ("Число цилиндров",["1","2","3","4"],"4"),
        ("Объём, л",[f"{v/10:.1f}".replace(".",",") for v in range(6,33)],"2,0"),
        ("Износ, %",[str(v) for v in range(0,81,5)],"55")],1):
        ttk.Label(frame,text=name).grid(row=i,column=0,sticky="w",pady=5)
        cb=ttk.Combobox(frame,values=choices,state="readonly",width=12);cb.set(default);cb.grid(row=i,column=1,sticky="e",pady=5);fields.append(cb)
    fault=tk.BooleanVar(value=False)
    switch=ttk.Checkbutton(frame,text="Показать обрыв шатуна во 2-м цилиндре",variable=fault)
    switch.grid(row=4,column=0,columnspan=2,sticky="w",pady=9)
    fields[0].bind("<<ComboboxSelected>>",lambda _:switch.state(["disabled"] if fields[0].get()=="1" else ["!disabled"]))
    status=tk.StringVar(value="В файл войдут модель, анимация и звук.")
    ttk.Label(frame,textvariable=status,wraplength=325).grid(row=5,column=0,columnspan=2,sticky="w",pady=8)
    q=Queue()
    def poll():
        try:
            while True:
                kind,payload=q.get_nowait()
                if kind=="progress":status.set(payload)
                elif kind=="error":
                    button.state(["!disabled"]);status.set("Сборка прервана.");messagebox.showerror("Конструктор",payload);return
                else:
                    blender,path=payload;button.state(["!disabled"]);status.set("Сохранено: "+path.name)
                    subprocess.Popen([blender,str(path)]);return
        except Empty:app.after(150,poll)
    def start():
        count=int(fields[0].get());litres=float(fields[1].get().replace(",","."));wear=int(fields[2].get())
        mode="rod" if count>1 and fault.get() else "none"
        path=filedialog.asksaveasfilename(title="Сохранить собранный мотор",initialdir=ROOT/"dist/blender",
            initialfile=f"Motor I{count} {litres:.1f}L {wear}pct.blend",defaultextension=".blend",filetypes=[("Blender","*.blend")])
        if not path:return
        button.state(["disabled"])
        def worker():
            try:q.put(("done",(build(count,litres,wear,mode,Path(path),lambda msg:q.put(("progress",msg))),Path(path))))
            except Exception as exc:q.put(("error",str(exc)))
        threading.Thread(target=worker,daemon=False).start();app.after(150,poll)
    button=ttk.Button(frame,text="Собрать и открыть в Blender",command=start)
    button.grid(row=6,column=0,columnspan=2,sticky="ew",pady=(8,0));app.mainloop()

if __name__=="__main__":
    if len(sys.argv)==1:
        form()
    else:
        p=argparse.ArgumentParser()
        p.add_argument("--cylinders",type=int,choices=range(1,5),required=True)
        p.add_argument("--litres",type=float,required=True)
        p.add_argument("--wear",type=float,required=True,help="Initial wear in percent")
        p.add_argument("--fault",choices=("rod","none"),default="none")
        p.add_argument("--out",type=Path,required=True)
        a=p.parse_args()
        build(a.cylinders,a.litres,a.wear,a.fault,a.out,lambda msg:print(msg,flush=True))

