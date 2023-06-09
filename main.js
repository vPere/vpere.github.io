$(document).ready(function() {
    $('.dropdown-menu .dropdown-item').on('click', function(e) {
        e.preventDefault();
        const locale = $(this).attr('data-locale');
        loadLocale(locale);
    });
});
