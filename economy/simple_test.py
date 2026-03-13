from EmQuantAPI import *
import ctypes
from datetime import datetime

def log_callback(msg):
    try:
        if isinstance(msg, bytes):
            msg_str = msg.decode('utf-8', errors='ignore').strip()
        else:
            msg_str = str(msg)

        if 'heartbeat' not in msg_str.lower():
            print(f"[LOG] {msg_str}")
    except:
        pass
    return 0

options = "UserName=bflzg0006,PassWord=tx654954,TestLatency=1,ForceLogin=0"
loginresult = c.start(options, log_callback, None)

if loginresult.ErrorCode == 0:
    print("=" * 50)
    print("EMQuantAPI 数据获取示例")
    print("=" * 50)


    data=c.css("A0.DCE,AD0.SHF,AG0.SHF,AL0.SHF,AO0.SHF,AP0.CZC,AU0.SHF,B0.DCE,BB0.DCE,BCM.INE,BR0.SHF,BU0.SHF,BZ0.DCE,C0.DCE,CF0.CZC,CJ0.CZC,CS0.DCE,CU0.SHF,CY0.CZC,EB0.DCE,ECM.INE,EG0.DCE,FB0.DCE,FG0.CZC,FU0.SHF,HC0.SHF,I0.DCE,J0.DCE,JD0.DCE,JM0.DCE,JR0.CZC,L0.DCE,LCM.GFE,LF0.DCE,LG0.DCE,LH0.DCE,LR0.CZC,LUM.INE,M0.DCE,MA0.CZC,NI0.SHF,NRM.INE,OI0.CZC,OP0.SHF,P0.DCE,PB0.SHF,PDM.GFE,PF0.CZC,PG0.DCE,PK0.CZC,PL0.CZC,PM0.CZC,PP0.DCE,PPF0.DCE,PR0.CZC,PSM.GFE,PTM.GFE,PX0.CZC,RB0.SHF,RI0.CZC,RM0.CZC,RR0.DCE,RS0.CZC,RU0.SHF,SA0.CZC,SCM.INE,SF0.CZC,SH0.CZC,SIM.GFE,SM0.CZC,SN0.SHF,SP0.SHF,SR0.CZC,SS0.SHF,TA0.CZC,UR0.CZC,V0.DCE,VF0.DCE,WH0.CZC,WR0.SHF,Y0.DCE,ZC0.CZC,ZN0.SHF","NAME,CLEARDIFFERRANGE,AMOUNT","TradeDate=2026-01-23")
    print(data)

    logout = c.stop()
    if logout.ErrorCode == 0:
        print("已退出登录")
        
else:
    print(f"登录失败: {loginresult.ErrorMsg}")