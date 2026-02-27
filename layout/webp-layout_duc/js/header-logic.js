document.addEventListener('DOMContentLoaded', () => {
    const header = document.getElementById('smartHeader');
    const headerHeight = header.offsetHeight; // Get the height of the header
    let lastScrollTop = 0; // Tracks the previous scroll position
    let isHovering = false; // Tracks if the mouse is in the active zone

    // --- Part 1: Scroll Logic (Hide/Show based on scroll direction) ---
    
    window.addEventListener('scroll', () => {
        const currentScrollTop = window.scrollY || document.documentElement.scrollTop;

        // Only run if the user has scrolled beyond the header height
        if (currentScrollTop > headerHeight) {
            
            if (currentScrollTop > lastScrollTop) {
                // Scrolling DOWN: Hide the header
                header.classList.add('header-hidden');
            } else {
                // Scrolling UP: Show the header
                // Unless the mouse is currently in the active zone, scrolling up should show it
                if (!isHovering) {
                    header.classList.remove('header-hidden');
                }
            }
        } else {
            // Near the top of the page: Always show the header
            header.classList.remove('header-hidden');
        }

        lastScrollTop = currentScrollTop <= 0 ? 0 : currentScrollTop; // For mobile browsers
    });


    // --- Part 2: Hover Logic (Reappear when mouse is near the top) ---

    // Create a temporary element to act as the "hover zone"
    const activeZone = document.createElement('div');
    activeZone.className = 'header-active-zone';
    document.body.prepend(activeZone);

    activeZone.addEventListener('mouseenter', () => {
        isHovering = true;
        // When the mouse enters the zone, show the header
        header.classList.remove('header-hidden');
    });

    activeZone.addEventListener('mouseleave', () => {
        isHovering = false;
        // When the mouse leaves the zone, check if we need to hide it again
        if (window.scrollY > headerHeight) {
            header.classList.add('header-hidden');
        }
    });
});