"""Build original vector portraits and four-state sprite sheets from the catalog.

Each persona has a stable identity and sixteen hand-shaped animation frames:
four idle, four working, four posting, and four editing. No remote assets.
"""
import html
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def head(index, brief, x=0, y=0, monochrome=False):
    # Ten visibly different silhouettes crossed with five hair colours give all
    # 50 catalog personas a distinct head shape/colour pairing.
    hair_color = (['#202020', '#414141', '#5c5c5c', '#303030', '#747474'] if monochrome else ['#242526', '#49352f', '#5a4638', '#302d3e', '#6a5142'])[index // 10]
    skin = (['#f0f0f0', '#d3d3d3', '#b5b5b5', '#929292', '#696969'] if monochrome else ['#f4d7bd', '#dfb493', '#c98e6c', '#a96e54', '#754b3d'])[(index * 3) % 5]
    outline = '#292929' if monochrome else '#292b2a'
    styles = [
        '<path d="M15 29Q12 9 30 9Q49 7 50 29L43 20Q31 24 21 18Z"/>',
        '<path d="M14 40V25Q13 8 32 8Q51 8 50 26V40L44 36V22L20 23V38Z"/>',
        '<path d="M15 26Q8 16 17 13Q15 4 25 8Q31 1 36 8Q47 3 47 13Q57 17 49 29L43 20Q30 25 20 18Z"/>',
        '<path d="M15 30Q8 10 29 9Q52 5 50 27L39 18L18 24Z"/>',
        '<path d="M16 24Q12 8 31 8Q51 7 49 25L41 18L21 20Z"/><path d="M45 15Q61 25 49 43L45 39Q52 27 43 22Z"/>',
        '<path d="M14 32V20Q18 5 38 9Q54 11 49 32L42 22L19 23Z"/><path d="M18 13Q29 3 42 13L34 16Z"/>',
        '<path d="M14 27Q11 9 29 8Q48 5 50 26L43 17L36 24L24 17Z"/>',
        '<path d="M13 38V24Q14 7 32 8Q50 8 51 25V38L44 33V21Q32 16 20 23V35Z"/>',
        '<path d="M14 30Q8 13 20 10Q30 4 38 10Q52 7 50 27L44 19Q32 23 19 18Z"/><circle cx="18" cy="19" r="4"/><circle cx="45" cy="18" r="4"/>',
        '<path d="M15 28Q11 10 29 8Q48 7 50 26L45 19L39 21L34 15L28 22L21 18Z"/><path d="M43 15Q58 22 52 34" fill="none" stroke-width="3"/>',
    ][index % 10]
    hair = f'<g fill="{hair_color}" stroke="{outline}" stroke-width=".8" stroke-linejoin="round">{styles}</g>'
    eye_shapes = [
        '<path d="M22 28h4m12 0h4" stroke-width="2.4" stroke-linecap="round"/>',
        '<path d="M21 28q3-3 6 0m10 0q3-3 6 0" stroke-width="1.5" fill="none"/>',
        '<circle cx="24" cy="28" r="1.4"/><circle cx="40" cy="28" r="1.4"/>',
        '<path d="M21 29l5-2m10 2l5-2" stroke-width="1.5" stroke-linecap="round"/>',
    ][index % 4]
    mouth_shapes = [
        '<path d="M27 41q5 3 10 0"/>',
        '<path d="M27 41q5-2 10 0"/>',
        '<path d="M29 42h6"/>',
        '<path d="M27 40q5 5 10 0"/>',
        '<path d="M27 41q5 1 10-1"/>',
    ][index % 5]
    glasses = f'<g fill="none" stroke="{"#252525" if monochrome else "#252727"}" stroke-width="1.4"><rect x="19" y="25" width="11" height="8" rx="3"/><rect x="34" y="25" width="11" height="8" rx="3"/><path d="M30 28h4m-15 0h-3m28 0h3"/></g>' if any(w in brief for w in ("glasses", "frames", "eyewear")) else ''
    earrings = f'<circle cx="16" cy="37" r="2.2" fill="none" stroke="{"#555555" if monochrome else "#d09b48"}" stroke-width="1.2"/><circle cx="48" cy="37" r="2.2" fill="none" stroke="{"#555555" if monochrome else "#d09b48"}" stroke-width="1.2"/>' if "earring" in brief else ''
    freckles = f'<g fill="{"#666666" if monochrome else "#704d40"}"><circle cx="23" cy="36" r=".6"/><circle cx="26" cy="37" r=".6"/><circle cx="39" cy="36" r=".6"/></g>' if index % 3 == 0 else ''
    return f'<g transform="translate({x} {y})"><path d="M17 27Q16 12 32 11Q48 12 47 28L45 39Q42 48 32 49Q22 48 19 39Z" fill="{skin}" stroke="{outline}" stroke-width="1.4"/>{hair}<g fill="none" stroke="{outline}" stroke-linecap="round">{eye_shapes}<path d="M32 29l-2 7h3" stroke-width="1.1"/>{mouth_shapes}</g>{glasses}{earrings}{freckles}</g>'


def portrait(index, agent):
    shirt = ['#444444', '#686868', '#303030', '#7a7a7a', '#555555'][index % 5]
    body = f'<path d="M6 80V66Q7 52 27 50h10q20 2 21 16v14" fill="{shirt}" stroke="#292929" stroke-width="1.6"/><path d="M26 48v6l6 5l6-5v-6" fill="#eeeeee" stroke="#292929" stroke-width="1.4"/><path d="M27 59l5 5l5-5" fill="none" stroke="#eeeeee" stroke-width="1.2"/>'
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 80" role="img"><title>{html.escape(agent["name"])} portrait</title>{body}{head(index, agent["avatarBrief"], monochrome=True)}</svg>'


def sprite(index, agent):
    cells = []
    for state in range(4):
        for frame in range(4):
            bob = [0, -1, 0, 1][frame]
            arm = [0, -3, -5, -2][frame] if state in (2, 3) else [0, 1, 0, -1][frame]
            fill = ['#b8c7be', '#c6bfae', '#afbec7', '#c7b7ae', '#bdc0cd'][index % 5]
            body = f'<path d="M25 57l-2 17h7l2-12l3 12h7l-4-17" fill="#565d57" stroke="#263329"/><path d="M19 41q13-7 26 0l-3 20H22Z" fill="{fill}" stroke="#263329" stroke-width="1.5"/><path d="M20 43l-4 {13+arm}m28-13l6 {13-arm}" fill="none" stroke="#263329" stroke-width="4" stroke-linecap="round"/>'
            prop = '<path d="M40 49h17v11H40Z" fill="#f6f0d8" stroke="#263329"/><path d="M44 53h9m-9 3h6" stroke="#7a806d"/>' if state == 3 else '<path d="M47 25h12v9h-6l-3 3v-3h-3Z" fill="#f9f8ee" stroke="#263329"/>' if state == 2 else ''
            face = f'<g transform="translate(11 {-1 + bob}) scale(.66)">{head(index, agent["avatarBrief"])}</g>'
            cells.append(f'<g transform="translate({(state * 4 + frame) * 64} 0)"><ellipse cx="32" cy="77" rx="19" ry="2" fill="#d6d9cb"/>{body}{face}{prop}</g>')
    return '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="80" viewBox="0 0 1024 80"><title>' + html.escape(agent['name']) + ' animation sheet</title>' + ''.join(cells) + '</svg>'


if __name__ == '__main__':
    agents = json.loads((ROOT / 'chorus/harness/catalog.json').read_text())['agents']
    target = ROOT / 'chorus/harness/assets'
    target.mkdir(exist_ok=True)
    for index, agent in enumerate(agents):
        (target / f'{agent["id"]}-portrait.svg').write_text(portrait(index, agent))
        (target / f'{agent["id"]}-sprite.svg').write_text(sprite(index, agent))
    (ROOT / 'chorus/harness/art-manifest.json').write_text(json.dumps({a['id']: {'portrait': f'{a["id"]}-portrait.svg', 'sprite': f'{a["id"]}-sprite.svg', 'frames': 16, 'states': ['idle', 'working', 'posting', 'editing']} for a in agents}, indent=2) + '\n')
