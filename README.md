# Sprite Recolor Tool

A browser-based tool for recoloring sprites using reference textures. Originally created for generating shiny Pokémon icons for Brilliant Diamond & Shining Pearl (BDSP) mods, this versatile tool can recolor any sprites by analyzing texture pairs and applying sophisticated color transformations.

The tool uses advanced color analysis and clustering algorithms that work with any sprite artwork, mapping colors from reference texture pairs to sprite pixels using CIE LAB color space for perceptually accurate results.

Originally created by **ttin**, enhanced and maintained by **Blup**. (AI assisted)

## Features

- **Automatic Color Analysis**: Compares normal and shiny texture pairs using CIE LAB color space for accurate color matching
- **K-Means Clustering**: Groups sprite pixels into color families for region-based recoloring
- **Region Detection**: Uses flood-fill algorithms to identify connected color regions
- **Manual Fine-tuning**: Comprehensive controls for adjusting individual regions and pixels
- **Zoom Mode**: Pixel-perfect editing with magnified view
- **Customizable Hotkeys**: Streamlined workflow with configurable keyboard shortcuts
- **Debug Overlay**: Visual feedback for protected pixels and color families
- **Texture Preview**: Side-by-side comparison of normal and shiny texture references

## Usage

### Quick Start

1. Visit **[https://blupblurp.github.io/sprite-recolor-tool/](https://blupblurp.github.io/sprite-recolor-tool/)** in a web browser
2. Click "Select Files" and choose a folder containing your reference textures and sprites
3. Select a sprite from the dropdown list
4. Click "Load Selected" to process the files
5. Adjust parameters and regions as needed
6. Save your recolored sprite

### File Structure

The tool was originally designed for BDSP mod folder structures, so at the moment, it expects the following folder structure:

```text
pm####_##_##/
├── textures/
│   ├── pm####_##_##_col.png        (normal texture)
│   └── pm####_##_##_col_rare.png   (shiny texture)
└── icon/
    └── pm####_##_##.png            (sprite to recolor)
```

### Key Controls

- **Family Count**: Adjust the number of color families
- **Outline Protection**: Preserve sprite outlines during recoloring
- **Smoothing**: Apply color smoothing for better transitions
- **Region Controls**: Manual color adjustment, linking, and brightness control
- **Zoom Mode**: Pixel-perfect editing with selection tools

## BDSP Shiny Icons Repository

This tool was specifically used to create a collection of **1554 shiny Pokémon icons** covering all generations, alternative forms, regional variants, Mega Evolutions, and special forms. The collection is available at:

**[BDSP Shiny Icons Repository](https://github.com/BlupBlurp/bdsp-shiny-icons)**

## License

This tool is free to use for personal and community projects. Attribution to the original creators is appreciated when using in public projects.

## Credits

- **ttin**

- **Blup**
