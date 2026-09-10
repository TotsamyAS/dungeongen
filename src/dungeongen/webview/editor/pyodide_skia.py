"""Small skia-python compatibility layer backed by CanvasKit in Pyodide.

Only APIs used by dungeongen's browser render path are implemented here.  Native
server rendering still imports the real ``skia`` package; this module is mounted
as ``/skia.py`` by the Pyodide worker before the project package is imported.
"""

from __future__ import annotations

import math

import numpy as np
from pathlib import Path as FilePath
from types import SimpleNamespace
from typing import Any, Iterable

from js import Uint8Array, globalThis, dungeongenCanvasKit as _CK
from pyodide.ffi import to_js


def Color(r: int, g: int, b: int, a: int = 255) -> int:
    return ((int(a) & 255) << 24) | ((int(r) & 255) << 16) | ((int(g) & 255) << 8) | (int(b) & 255)


def ColorSetRGB(r: int, g: int, b: int) -> int:
    return Color(r, g, b)


ColorBLACK = Color(0, 0, 0)
ColorWHITE = Color(255, 255, 255)
ColorRED = Color(255, 0, 0)
ColorBLUE = Color(0, 0, 255)
kPNG = "png"
kJPEG = "jpeg"


def _ck_color(value: Any):
    if isinstance(value, Color4f):
        return _CK.Color4f(value.fR, value.fG, value.fB, value.fA)
    packed = int(value if value is not None else ColorBLACK)
    a = (packed >> 24) & 255
    r = (packed >> 16) & 255
    g = (packed >> 8) & 255
    b = packed & 255
    return _CK.Color(r, g, b, a / 255.0)


class Color4f:
    def __init__(self, r: float, g: float, b: float, a: float = 1.0):
        self.fR = float(r)
        self.fG = float(g)
        self.fB = float(b)
        self.fA = float(a)

    @classmethod
    def FromColor(cls, color: int) -> "Color4f":
        packed = int(color)
        return cls(
            ((packed >> 16) & 255) / 255.0,
            ((packed >> 8) & 255) / 255.0,
            (packed & 255) / 255.0,
            ((packed >> 24) & 255) / 255.0,
        )


class Rect:
    def __init__(self, left: float, top: float, right: float, bottom: float):
        self._left = float(left)
        self._top = float(top)
        self._right = float(right)
        self._bottom = float(bottom)

    @classmethod
    def MakeWH(cls, width: float, height: float) -> "Rect":
        return cls(0, 0, width, height)

    @classmethod
    def MakeXYWH(cls, x: float, y: float, width: float, height: float) -> "Rect":
        return cls(x, y, x + width, y + height)

    @classmethod
    def MakeLTRB(cls, left: float, top: float, right: float, bottom: float) -> "Rect":
        return cls(left, top, right, bottom)

    def left(self) -> float:
        return self._left

    def top(self) -> float:
        return self._top

    def right(self) -> float:
        return self._right

    def bottom(self) -> float:
        return self._bottom

    def width(self) -> float:
        return self._right - self._left

    def height(self) -> float:
        return self._bottom - self._top

    def _js(self):
        return _CK.LTRBRect(self._left, self._top, self._right, self._bottom)

    @classmethod
    def _from_js(cls, value: Any) -> "Rect":
        return cls(float(value[0]), float(value[1]), float(value[2]), float(value[3]))


class RRect:
    def __init__(self, rect: Rect, rx: float, ry: float):
        self.rect = rect
        self.rx = float(rx)
        self.ry = float(ry)

    @classmethod
    def MakeRectXY(cls, rect: Rect, rx: float, ry: float) -> "RRect":
        return cls(rect, rx, ry)

    def _js(self):
        return _CK.RRectXY(self.rect._js(), self.rx, self.ry)


def _matrix_mul(left: list[float], right: list[float]) -> list[float]:
    out = [0.0] * 9
    for row in range(3):
        for col in range(3):
            out[row * 3 + col] = sum(left[row * 3 + k] * right[k * 3 + col] for k in range(3))
    return out


class Matrix:
    def __init__(self):
        self.values = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0]

    def _set(self, values: Iterable[float]) -> "Matrix":
        self.values = [float(value) for value in values]
        return self

    def setScale(self, sx: float, sy: float) -> "Matrix":
        return self._set([sx, 0, 0, 0, sy, 0, 0, 0, 1])

    def setRotate(self, degrees: float) -> "Matrix":
        radians = math.radians(degrees)
        c = math.cos(radians)
        s = math.sin(radians)
        return self._set([c, -s, 0, s, c, 0, 0, 0, 1])

    def setTranslate(self, dx: float, dy: float) -> "Matrix":
        return self._set([1, 0, dx, 0, 1, dy, 0, 0, 1])

    def preTranslate(self, dx: float, dy: float) -> "Matrix":
        self.values = _matrix_mul(self.values, [1, 0, dx, 0, 1, dy, 0, 0, 1])
        return self

    def postTranslate(self, dx: float, dy: float) -> "Matrix":
        self.values = _matrix_mul([1, 0, dx, 0, 1, dy, 0, 0, 1], self.values)
        return self

    def preScale(self, sx: float, sy: float) -> "Matrix":
        self.values = _matrix_mul(self.values, [sx, 0, 0, 0, sy, 0, 0, 0, 1])
        return self

    def postScale(self, sx: float, sy: float) -> "Matrix":
        self.values = _matrix_mul([sx, 0, 0, 0, sy, 0, 0, 0, 1], self.values)
        return self

    def postRotate(self, degrees: float) -> "Matrix":
        rotation = Matrix().setRotate(degrees).values
        self.values = _matrix_mul(rotation, self.values)
        return self

    def postSkew(self, kx: float, ky: float) -> "Matrix":
        skew = [1, float(kx), 0, float(ky), 1, 0, 0, 0, 1]
        self.values = _matrix_mul(skew, self.values)
        return self

    def _js(self):
        return to_js(self.values)


class PathFillType:
    kEvenOdd = _CK.FillType.EvenOdd


class PathOp:
    kDifference_PathOp = _CK.PathOp.Difference
    kIntersect_PathOp = _CK.PathOp.Intersect
    kUnion_PathOp = _CK.PathOp.Union
    kXOR_PathOp = _CK.PathOp.XOR
    kReverseDifference_PathOp = _CK.PathOp.ReverseDifference


class ClipOp:
    kIntersect = _CK.ClipOp.Intersect
    kDifference = _CK.ClipOp.Difference


class Path:
    def __init__(self, _path: Any = None):
        # CanvasKit 0.41+ made Path immutable.  Keep the mutable state in a
        # PathBuilder so the existing skia-python callers can keep mutating a
        # skia.Path in place without changing any renderer/generator logic.
        self._value = _CK.PathBuilder.new() if _path is None else _CK.PathBuilder.new(_path)
        self._cached_path = _path

    @classmethod
    def _from_js(cls, value: Any) -> "Path":
        result = cls.__new__(cls)
        result._value = _CK.PathBuilder.new(value)
        # Keep the already-created immutable result until the next mutation.
        result._cached_path = value
        return result

    def _invalidate(self) -> None:
        cached = getattr(self, "_cached_path", None)
        self._cached_path = None
        if cached is not None:
            try:
                cached.delete()
            except Exception:
                pass

    def _path(self):
        if self._cached_path is None:
            self._cached_path = self._value.snapshot()
        return self._cached_path

    def moveTo(self, x: float, y: float) -> "Path":
        self._invalidate()
        self._value.moveTo(x, y)
        return self

    def lineTo(self, x: float, y: float) -> "Path":
        self._invalidate()
        self._value.lineTo(x, y)
        return self

    def quadTo(self, x1: float, y1: float, x2: float, y2: float) -> "Path":
        self._invalidate()
        self._value.quadTo(x1, y1, x2, y2)
        return self

    def cubicTo(self, x1: float, y1: float, x2: float, y2: float, x3: float, y3: float) -> "Path":
        self._invalidate()
        self._value.cubicTo(x1, y1, x2, y2, x3, y3)
        return self

    def close(self) -> "Path":
        self._invalidate()
        self._value.close()
        return self

    def addRect(self, rect: Rect) -> "Path":
        self._invalidate()
        self._value.addRect(rect._js())
        return self

    def addRRect(self, rrect: RRect) -> "Path":
        self._invalidate()
        self._value.addRRect(rrect._js())
        return self

    def addCircle(self, x: float, y: float, radius: float) -> "Path":
        self._invalidate()
        self._value.addCircle(x, y, radius)
        return self

    def addPath(self, other: "Path") -> "Path":
        self._invalidate()
        self._value.addPath(other._path())
        return self

    def offset(self, dx: float, dy: float) -> "Path":
        self._invalidate()
        self._value.offset(dx, dy)
        return self

    def transform(self, matrix: Matrix) -> "Path":
        self._invalidate()
        self._value.transform(*matrix.values)
        return self

    def setFillType(self, fill_type: Any) -> "Path":
        self._invalidate()
        self._value.setFillType(fill_type)
        return self

    def getBounds(self) -> Rect:
        return Rect._from_js(self._value.getBounds())

    def contains(self, x: float, y: float) -> bool:
        return bool(self._value.contains(float(x), float(y)))

    def __del__(self):
        self._invalidate()
        try:
            value = getattr(self, "_value", None)
            if value is not None:
                value.delete()
        except Exception:
            pass


def Op(one: Path, two: Path, operation: Any) -> Path | None:
    result = _CK.Path.MakeFromOp(one._path(), two._path(), operation)
    if result is None:
        return None
    return Path._from_js(result)


class Paint:
    kFill_Style = _CK.PaintStyle.Fill
    kStroke_Style = _CK.PaintStyle.Stroke
    kRound_Join = _CK.StrokeJoin.Round
    kRound_Cap = _CK.StrokeCap.Round

    def __init__(
        self,
        *,
        AntiAlias: bool = False,
        Style: Any = None,
        Color: Any = None,
        Color4f: Any = None,
        StrokeWidth: float | None = None,
        StrokeJoin: Any = None,
        StrokeCap: Any = None,
        **_: Any,
    ):
        self._paint = _CK.Paint.new()
        self._paint.setAntiAlias(bool(AntiAlias))
        self._paint.setStyle(self.kFill_Style if Style is None else Style)
        if Color4f is not None:
            self._paint.setColor(_ck_color(Color4f))
        elif Color is not None:
            self._paint.setColor(_ck_color(Color))
        if StrokeWidth is not None:
            self._paint.setStrokeWidth(float(StrokeWidth))
        if StrokeJoin is not None:
            self._paint.setStrokeJoin(StrokeJoin)
        if StrokeCap is not None:
            self._paint.setStrokeCap(StrokeCap)

    def setPathEffect(self, effect: Any) -> None:
        self._paint.setPathEffect(getattr(effect, "_effect", effect))

    def __del__(self):
        try:
            self._paint.delete()
        except Exception:
            pass


class _ImageInfo:
    def __init__(self, width: int, height: int):
        self._width = int(width)
        self._height = int(height)

    def width(self) -> int:
        return self._width

    def height(self) -> int:
        return self._height


class Canvas:
    def __init__(self, canvas: Any, width: int | None = None, height: int | None = None):
        self._canvas = canvas
        self._width = int(width) if width is not None else 0
        self._height = int(height) if height is not None else 0

    def imageInfo(self) -> _ImageInfo:
        return _ImageInfo(self._width, self._height)

    def save(self):
        return self._canvas.save()

    def restore(self) -> None:
        self._canvas.restore()

    def restoreToCount(self, count: int) -> None:
        self._canvas.restoreToCount(count)

    def concat(self, matrix: Matrix) -> None:
        self._canvas.concat(matrix._js())

    def translate(self, dx: float, dy: float) -> None:
        self._canvas.translate(dx, dy)

    def rotate(self, degrees: float) -> None:
        self._canvas.rotate(degrees, 0, 0)

    def scale(self, sx: float, sy: float) -> None:
        self._canvas.scale(sx, sy)

    def clear(self, color: Any) -> None:
        self._canvas.clear(_ck_color(color))

    def clipPath(self, path: Path, operation: Any = None, antiAlias: bool = False) -> None:
        self._canvas.clipPath(
            path._path(),
            _CK.ClipOp.Intersect if operation is None else operation,
            bool(antiAlias),
        )

    def drawRect(self, rect: Rect, paint: Paint) -> None:
        self._canvas.drawRect(rect._js(), paint._paint)

    def drawRRect(self, rrect: RRect, paint: Paint) -> None:
        self._canvas.drawRRect(rrect._js(), paint._paint)

    def drawCircle(self, x: float, y: float, radius: float, paint: Paint) -> None:
        self._canvas.drawCircle(x, y, radius, paint._paint)

    def drawPath(self, path: Path, paint: Paint) -> None:
        self._canvas.drawPath(path._path(), paint._paint)

    def drawLine(self, x1: float, y1: float, x2: float, y2: float, paint: Paint) -> None:
        self._canvas.drawLine(x1, y1, x2, y2, paint._paint)

    def drawArc(self, oval: Rect, startAngle: float, sweepAngle: float, useCenter: bool, paint: Paint) -> None:
        self._canvas.drawArc(oval._js(), startAngle, sweepAngle, bool(useCenter), paint._paint)

    def drawString(self, text: str, x: float, y: float, font: "Font", paint: Paint) -> None:
        self._canvas.drawText(str(text), x, y, paint._paint, font._font)

    def drawTextBlob(self, blob: "TextBlob", x: float, y: float, paint: Paint) -> None:
        self._canvas.drawTextBlob(blob._blob, x, y, paint._paint)

    def drawPicture(self, picture: "Picture") -> None:
        self._canvas.drawPicture(picture._picture)


class _Data:
    def __init__(self, value: Any):
        self._value = value

    def bytes(self) -> bytes:
        return bytes(self)

    def __bytes__(self) -> bytes:
        length = int(self._value.length)
        output = bytearray(length)
        self._value.assign_to(output)
        return bytes(output)


class Image:
    def __init__(self, image: Any):
        self._image = image

    def encodeToData(self, fmt: Any = kPNG, quality: int = 100) -> _Data | None:
        image_format = _CK.ImageFormat.JPEG if fmt == kJPEG else _CK.ImageFormat.PNG
        encoded = self._image.encodeToBytes(image_format, int(quality))
        return None if encoded is None else _Data(encoded)

    def toarray(self):
        width = int(self._image.width())
        height = int(self._image.height())
        info = to_js({
            "width": width,
            "height": height,
            "colorType": _CK.ColorType.RGBA_8888,
            "alphaType": _CK.AlphaType.Unpremul,
            "colorSpace": _CK.ColorSpace.SRGB,
        })
        pixels = self._image.readPixels(0, 0, info)
        if pixels is None:
            raise RuntimeError("CanvasKit.Image.readPixels failed")
        return np.asarray(pixels.to_py(), dtype=np.uint8).reshape((height, width, 4))

    def save(self, filename: str, fmt: Any = kPNG, quality: int = 100) -> bool:
        data = self.encodeToData(fmt, quality)
        if data is None:
            return False
        FilePath(filename).write_bytes(bytes(data))
        return True

    def __del__(self):
        try:
            self._image.delete()
        except Exception:
            pass


class Surface:
    def __init__(self, width: int, height: int, *, _display: bool = False):
        self._width = int(width)
        self._height = int(height)
        self._display = bool(_display)
        if self._display:
            display_canvas = getattr(globalThis, "dungeongenDisplayCanvas", None)
            if display_canvas is None:
                raise RuntimeError("browserCanvasUnavailable")
            # Assigning width/height clears an OffscreenCanvas immediately. Keep the
            # previous canonical frame visible while the next one is rendered, and
            # only resize when the project bounds actually changed.
            if int(display_canvas.width) != self._width or int(display_canvas.height) != self._height:
                display_canvas.width = self._width
                display_canvas.height = self._height
            self._surface = _CK.MakeSWCanvasSurface(display_canvas)
        else:
            self._surface = _CK.MakeSurface(self._width, self._height)
        if self._surface is None:
            raise RuntimeError("CanvasKit surface creation failed")
        self._canvas = Canvas(self._surface.getCanvas(), self._width, self._height)

    @classmethod
    def MakeBrowserDisplay(cls, width: int, height: int) -> "Surface":
        return cls(width, height, _display=True)

    def getCanvas(self) -> Canvas:
        return self._canvas

    def flush(self) -> None:
        self._surface.flush()

    def makeImageSnapshot(self) -> Image:
        return Image(self._surface.makeImageSnapshot())

    def __del__(self):
        try:
            if self._display and hasattr(self._surface, "dispose"):
                self._surface.dispose()
            else:
                self._surface.delete()
        except Exception:
            pass


class Typeface:
    def __init__(self, _family: str | None = None, _value: Any = None):
        self._typeface = _value if _value is not None else _CK.Typeface.GetDefault()

    @classmethod
    def MakeFromFile(cls, filename: str) -> "Typeface" | None:
        try:
            payload = FilePath(filename).read_bytes()
        except OSError:
            return None
        array = Uint8Array.new(len(payload))
        array.assign(payload)
        value = _CK.Typeface.MakeTypefaceFromData(array.buffer)
        return None if value is None else cls(_value=value)


class Font:
    class Edging:
        kAntiAlias = _CK.FontEdging.AntiAlias

    def __init__(self, typeface: Typeface | None = None, size: float = 12):
        value = None if typeface is None else typeface._typeface
        self._font = _CK.Font.new(value, float(size))

    def getSize(self) -> float:
        return float(self._font.getSize())

    def measureText(self, text: str) -> float:
        glyphs = self._font.getGlyphIDs(str(text))
        widths = self._font.getGlyphWidths(glyphs)
        return float(sum(widths.to_py()))

    def textToGlyphs(self, text: str) -> list[int]:
        return [int(value) for value in self._font.getGlyphIDs(str(text)).to_py()]

    def getWidths(self, glyphs: Iterable[int]) -> list[float]:
        js_glyphs = to_js(list(glyphs))
        return [float(value) for value in self._font.getGlyphWidths(js_glyphs).to_py()]

    def getPath(self, _glyph: int) -> None:
        # Browser render uses _draw_structure_numbers/drawText, not glyph-outline SVG paths.
        return None

    def setEdging(self, edging: Any) -> None:
        self._font.setEdging(edging)

    def __del__(self):
        try:
            self._font.delete()
        except Exception:
            pass


class Picture:
    def __init__(self, picture: Any):
        self._picture = picture

    def __del__(self):
        try:
            self._picture.delete()
        except Exception:
            pass


class PictureRecorder:
    def __init__(self):
        self._recorder = _CK.PictureRecorder.new()
        self._canvas = None

    def beginRecording(self, bounds: Rect) -> Canvas:
        self._canvas = Canvas(self._recorder.beginRecording(bounds._js()), int(bounds.width()), int(bounds.height()))
        return self._canvas

    def finishRecordingAsPicture(self) -> Picture:
        return Picture(self._recorder.finishRecordingAsPicture())

    def __del__(self):
        try:
            self._recorder.delete()
        except Exception:
            pass


class TextBlob:
    def __init__(self, blob: Any):
        self._blob = blob

    @classmethod
    def MakeFromText(cls, text: str, font: Font) -> "TextBlob":
        return cls(_CK.TextBlob.MakeFromText(str(text), font._font))

    def __del__(self):
        try:
            self._blob.delete()
        except Exception:
            pass


class _PathEffectValue:
    def __init__(self, effect: Any):
        self._effect = effect


class PathEffect:
    @classmethod
    def MakeSum(cls, first: Any, second: Any):
        first_value = getattr(first, "_effect", first)
        second_value = getattr(second, "_effect", second)
        if hasattr(_CK.PathEffect, "MakeSum"):
            return _PathEffectValue(_CK.PathEffect.MakeSum(first_value, second_value))
        return first


class Path1DPathEffect:
    class Style:
        kTranslate_Style = _CK.Path1DEffect.Translate
        kRotate_Style = _CK.Path1DEffect.Rotate

    @classmethod
    def Make(cls, path: Path, advance: float, phase: float, style: Any):
        if hasattr(_CK.PathEffect, "MakePath1D"):
            return _PathEffectValue(_CK.PathEffect.MakePath1D(path._path(), advance, phase, style))
        return None


class DynamicMemoryWStream:
    def __init__(self, *_: Any, **__: Any):
        raise NotImplementedError("SVG streams are server-only; browser rendering uses CanvasKit directly")


class FILEWStream(DynamicMemoryWStream):
    pass


class SVGCanvas:
    @staticmethod
    def Make(*_: Any, **__: Any):
        raise NotImplementedError("SVGCanvas is server-only; browser rendering uses CanvasKit directly")


# Type aliases used only by annotations/debug code.
PathEffect.Style = SimpleNamespace()
