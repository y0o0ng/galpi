"""6편 도트 그림: 번호 패킷 블록, 점선 빈칸, 이름 붙은 상자, SEND·RECV·APP 무대(길·RECV→APP 화살표), 메시지 띠.
도식이며 실측이 아니다. 블록은 폭 14·높이 16(숫자 label 10px가 읽힌다), 한 칸 15px."""
from px import engine as E
from px.templates import flow

BW, BH, PITCH = 14, 16, 15
ROW_Y, APP_Y = 98, 168                           # 길·RECV 안 블록 줄의 윗면, APP 안 블록 줄의 윗면
SEND_BOX, RECV_Y, APP_BOX_Y = (4, 88, 24, 123), (88, 123), (158, 193)
RECV_X_STREAM, RECV_X_LOST = 118, 105            # RECV 상자 왼쪽 x(오른쪽은 172). stream은 세 칸, lost 계열은 네 칸
TRACK_Y = 119                                    # 길 점선(블록 줄 아래)


def dotted_rect(d, box, col):
    """1px 점선 사각(2px 켜고 2px 끔)."""
    x0, y0, x1, y1 = box
    for x in range(x0, x1 + 1):
        if x % 4 < 2:
            d.point((x, y0), fill=col)
            d.point((x, y1), fill=col)
    for y in range(y0, y1 + 1):
        if y % 4 < 2:
            d.point((x0, y), fill=col)
            d.point((x1, y), fill=col)


def block(img, d, x, y, n, style="ink", w=BW, h=BH):
    """번호 블록. ink: 지나가는 데이터, deep: 도착했지만 붙잡힘, danger: 사라지는 3, text: 깜빡일 때 밝게. n이 None이면 숫자 없음."""
    fill, line, num = {"ink": (E.INK, E.INK, E.BG), "deep": (E.DEEP, E.LABEL, E.TEXT),
                       "danger": (E.DANGER, E.DANGER, E.TEXT), "text": (E.TEXT, E.TEXT, E.BG),
                       "blink": (E.DEEP, E.TEXT, E.TEXT)}[style]
    d.rectangle((x, y, x + w - 1, y + h - 1), fill=fill, outline=line)
    if n is not None:
        s = str(n)
        E.text(img, (x + (w - E.text_w(s, "label")) // 2, y + (h - 10) // 2 - 1), s, "label", num, shadow=style in ("deep", "danger", "blink"))


def message(d, x, y, n, w, h, fill, line=E.BG):
    """메시지 띠: 폭 w 블록 n개가 틈 없이 붙은 줄(블록 사이는 line 색 선)."""
    for i in range(n):
        d.rectangle((x + i * w, y, x + i * w + w - 1, y + h - 1), fill=fill, outline=line)


def gap(d, x, y, w=BW, h=BH):
    """빈칸: DANGER 점선 사각."""
    dotted_rect(d, (x, y, x + w - 1, y + h - 1), E.DANGER)


def box(img, d, rect, label, lx, ly, col=E.LABEL):
    """이름 붙은 상자(CARD 바탕). 라벨은 (lx, ly)에 왼쪽 위를 맞춘다."""
    d.rectangle(rect, fill=E.CARD, outline=col)
    E.text(img, (lx, ly), label, "label", E.LABEL)


def send_box(img, d):
    x0, y0, x1, y1 = SEND_BOX
    box(img, d, SEND_BOX, "SEND", x0 + (x1 - x0 - E.text_w("SEND", "label")) // 2 + 1, y0 - 12)


def stage(img, d, recv_x0, track=None, arrow=None, send=True):
    """SEND(왼쪽) → 길 → RECV(오른쪽), RECV 아래 APP. recv_x0: RECV·APP 왼쪽 x(stream 118, lost 계열 105; APP도 같은 폭).
    track·arrow: None이거나 (진행도 u, 점선 위상 px, 색). 블록은 호출한 쪽이 이 위에 그린다(send=False면 SEND는 나중에 따로)."""
    app_x0 = recv_x0 if recv_x0 == RECV_X_STREAM else 75
    cx = (recv_x0 + 172) // 2
    box(img, d, (recv_x0, RECV_Y[0], 172, RECV_Y[1]), "RECV", cx - E.text_w("RECV", "label") // 2, RECV_Y[0] - 12)
    box(img, d, (app_x0, APP_BOX_Y[0], 172, APP_BOX_Y[1]), "APP", (app_x0 + 172 - E.text_w("APP", "label")) // 2, APP_BOX_Y[1] + 3)
    if track and track[0] > 0:
        u, ph, col = track
        flow(d, 0, ((27, TRACK_Y), (recv_x0 - 2, TRACK_Y)), col, u, phase=ph)
    if arrow and arrow[0] > 0:
        u, ph, col = arrow
        x = 161                                  # 줄 맨 앞 칸(1번·빈칸, x 154–168)의 가운데
        flow(d, 0, ((x, RECV_Y[1] + 3), (x, APP_BOX_Y[0] - 3)), col, u, phase=ph)
    if send:
        send_box(img, d)


def app_x(n):
    """APP 안 n번째로 받은 블록의 x(오른쪽부터 왼쪽으로 쌓인다)."""
    return 154 - PITCH * (n - 1)


def sign_ne(img, d, cx, cy, col):
    """≠ 도트 도형: 위·아래 막대 두 줄 + 45° 사선."""
    d.rectangle((cx - 5, cy - 3, cx + 5, cy - 2), fill=col)
    d.rectangle((cx - 5, cy + 2, cx + 5, cy + 3), fill=col)
    for i in range(-5, 6):
        d.rectangle((cx + i, cy - i, cx + i + 1, cy - i), fill=col)
